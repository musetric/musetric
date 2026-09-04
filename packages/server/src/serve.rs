use std::{
    io::{self, Write},
    net::{SocketAddr, TcpListener as StdTcpListener},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::Router;
use axum_server::{Handle, tls_rustls::RustlsConfig};
use musetric_db::{BoxedError, MigrationFailure, MigrationReport, Reader, Writer, init_database};
use musetric_gpu::{Bundle, create_client};
use musetric_jobs::{Queue, QueueOptions};
use musetric_media::SymphoniaPcm;
use rcgen::generate_simple_self_signed;
use serde_json::{Map, Value, json};
use tokio::{io::stdin, net::TcpListener, sync::oneshot};

use crate::{
    analysis::{AnalysisContext, AnalysisRunner},
    frontend::Frontend,
    garbage::spawn_collector,
    page_bridge::PageBridge,
    pages::PageOpener,
    router::{RouterOptions, create_router},
    storage::Storage,
};

const READY_PREFIX: &str = "MUSETRIC_PROXY_URL=";
const MIGRATION_PREFIX: &str = "MUSETRIC_MIGRATION=";
const MIGRATION_FAILED_PREFIX: &str = "MUSETRIC_MIGRATION_FAILED=";
const SHUTDOWN_GRACE: Duration = Duration::from_secs(5);
const PROCESSING_INTERVAL: Duration = Duration::from_secs(10);
const STEP_IDLE_LIMIT: Duration = Duration::from_mins(10);

pub struct ServerOptions {
    pub listen: String,
    pub database: PathBuf,
    pub blobs: PathBuf,
    pub models: PathBuf,
    pub browser_bundle: PathBuf,
    pub public: PathBuf,
    pub processing: bool,
    pub tls_self_signed: bool,
    pub tls: Option<TlsOptions>,
}

pub struct TlsOptions {
    pub certificate: PathBuf,
    pub private_key: PathBuf,
}

pub struct EmbeddedServerOptions {
    pub listen: String,
    pub database: PathBuf,
    pub blobs: PathBuf,
    pub models: PathBuf,
    pub browser_bundle: Bundle,
    pub frontend: Frontend,
    pub processing: bool,
}

pub struct EmbeddedServer {
    url: String,
    shutdown: Mutex<Option<oneshot::Sender<()>>>,
}

impl EmbeddedServer {
    #[must_use]
    pub fn url(&self) -> &str {
        &self.url
    }

    pub fn close(&self) {
        let sender = self.shutdown.lock().ok().and_then(|mut guard| guard.take());
        if let Some(shutdown) = sender {
            let _ = shutdown.send(());
        }
    }
}

pub async fn serve(options: ServerOptions) -> Result<(), BoxedError> {
    let closing = watch_parent();
    match init_database(&options.database) {
        Ok(report) => announce_migration(&report),
        Err(failure) => {
            announce_migration_failure(&failure);
            return Err(failure.into());
        }
    }
    let storage = create_storage(&options.database, options.blobs)?;
    let app = create_app(AppOptions {
        storage,
        models: options.models,
        browser_bundle: Bundle::Directory(options.browser_bundle),
        frontend: Frontend::from_directory(options.public),
        processing: options.processing,
    })?;
    let socket = bind(&options.listen)?;
    let address = socket.local_addr()?;
    let tls = match options.tls {
        Some(files) => {
            Some(RustlsConfig::from_pem_file(files.certificate, files.private_key).await?)
        }
        None if options.tls_self_signed => Some(self_signed_config().await?),
        None => None,
    };
    if let Some(config) = tls {
        let handle = Handle::<SocketAddr>::new();
        tokio::spawn(shutdown_on_closed_parent(handle.clone(), closing));
        announce_ready("https", address);
        axum_server::from_tcp_rustls(socket, config)?
            .handle(handle)
            .serve(app.into_make_service())
            .await?;
        return Ok(());
    }
    let listener = TcpListener::from_std(socket)?;
    announce_ready("http", address);
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            let _ = closing.await;
        })
        .await?;
    Ok(())
}

pub async fn start_embedded(options: EmbeddedServerOptions) -> Result<EmbeddedServer, BoxedError> {
    init_database(&options.database)?;
    let storage = create_storage(&options.database, options.blobs)?;
    let app = create_app(AppOptions {
        storage,
        models: options.models,
        browser_bundle: options.browser_bundle,
        frontend: options.frontend,
        processing: options.processing,
    })?;
    let socket = bind(&options.listen)?;
    let address = socket.local_addr()?;
    let listener = TcpListener::from_std(socket)?;
    let (shutdown, closed) = oneshot::channel();
    tokio::spawn(async move {
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                let _ = closed.await;
            })
            .await;
    });
    Ok(EmbeddedServer {
        url: format!("http://{address}"),
        shutdown: Mutex::new(Some(shutdown)),
    })
}

struct AppOptions {
    storage: Arc<Storage>,
    models: PathBuf,
    browser_bundle: Bundle,
    frontend: Frontend,
    processing: bool,
}

fn create_app(options: AppOptions) -> Result<Router, BoxedError> {
    let storage = options.storage;
    let pages = PageBridge::create();
    let runner = AnalysisRunner::create(AnalysisContext {
        storage: Arc::clone(&storage),
        pages: Arc::clone(&pages) as Arc<dyn PageOpener>,
        client: create_client()?,
        models_path: options.models,
        bundle: options.browser_bundle,
    });
    let queue = Queue::create(QueueOptions {
        reader: Arc::clone(&storage.database),
        writer: Arc::clone(&storage.writer),
        runner: Arc::new(runner),
        interval: PROCESSING_INTERVAL,
        idle_limit: STEP_IDLE_LIMIT,
    });
    if options.processing {
        queue.spawn();
    }
    Ok(create_router(RouterOptions {
        frontend: options.frontend,
        storage,
        queue,
        pages,
    }))
}

fn watch_parent() -> oneshot::Receiver<()> {
    let (closed, closing) = oneshot::channel();
    tokio::spawn(async move {
        let _ = tokio::io::copy(&mut stdin(), &mut tokio::io::sink()).await;
        let _ = closed.send(());
    });
    closing
}

fn announce(line: &str) {
    let _ = writeln!(io::stdout().lock(), "{line}");
}

fn create_storage(database: &Path, blobs: PathBuf) -> Result<Arc<Storage>, BoxedError> {
    let storage = Arc::new(Storage {
        database: Arc::new(Reader::open(database)?),
        writer: Arc::new(Writer::open(database)?),
        blobs_path: blobs,
        pcm: Arc::new(SymphoniaPcm),
    });
    spawn_collector(Arc::clone(&storage));
    Ok(storage)
}

fn bind(listen: &str) -> Result<StdTcpListener, BoxedError> {
    let listener =
        StdTcpListener::bind(listen).map_err(|error| report_bind_failure(listen, error))?;
    listener.set_nonblocking(true)?;
    Ok(listener)
}

fn report_bind_failure(listen: &str, error: io::Error) -> io::Error {
    if error.kind() == io::ErrorKind::AddrInUse {
        let _ = writeln!(
            io::stderr().lock(),
            "the address {listen} is already in use"
        );
    }
    error
}

async fn self_signed_config() -> Result<RustlsConfig, BoxedError> {
    let certified = generate_simple_self_signed(vec!["localhost".to_owned()])?;
    let certificate = certified.cert.pem().into_bytes();
    let key = certified.key_pair.serialize_pem().into_bytes();
    Ok(RustlsConfig::from_pem(certificate, key).await?)
}

fn announce_ready(protocol: &str, address: SocketAddr) {
    announce(&format!("{READY_PREFIX}{protocol}://{address}"));
}

fn announce_migration(report: &MigrationReport) {
    let mut described = Map::new();
    described.insert("fromVersion".to_owned(), json!(report.from_version));
    described.insert("toVersion".to_owned(), json!(report.to_version));
    insert_backup(&mut described, report.backup_path.as_deref());
    announce(&format!("{MIGRATION_PREFIX}{}", Value::Object(described)));
}

fn announce_migration_failure(failure: &MigrationFailure) {
    let mut described = Map::new();
    described.insert("message".to_owned(), json!(failure.to_string()));
    if let Some(version) = failure.committed_version() {
        described.insert("committedVersion".to_owned(), json!(version));
    }
    insert_backup(&mut described, failure.backup_path());
    announce(&format!(
        "{MIGRATION_FAILED_PREFIX}{}",
        Value::Object(described)
    ));
}

fn insert_backup(described: &mut Map<String, Value>, backup_path: Option<&std::path::Path>) {
    if let Some(path) = backup_path {
        described.insert("backupPath".to_owned(), json!(path));
    }
}

async fn shutdown_on_closed_parent(handle: Handle<SocketAddr>, closing: oneshot::Receiver<()>) {
    let _ = closing.await;
    handle.graceful_shutdown(Some(SHUTDOWN_GRACE));
}

#[cfg(test)]
mod tests {
    use std::{
        fs::remove_dir_all,
        path::PathBuf,
        process::id,
        sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        },
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{EmbeddedServerOptions, start_embedded};
    use crate::{Asset, Assets, Bundle, Frontend};

    static WORKSPACE_COUNT: AtomicUsize = AtomicUsize::new(0);

    struct AppAssets;

    impl Assets for AppAssets {
        fn get(&self, path: &str) -> Option<Asset> {
            (path == "index.html").then(|| {
                Asset::create(
                    b"<!doctype html><title>Musetric</title>".to_vec(),
                    "text/html; charset=utf-8".to_owned(),
                )
            })
        }
    }

    struct Workspace {
        root: PathBuf,
    }

    impl Workspace {
        fn new() -> Self {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("the clock should be after the epoch")
                .as_nanos();
            let ordinal = WORKSPACE_COUNT.fetch_add(1, Ordering::Relaxed);
            let root = std::env::temp_dir().join(format!(
                "musetric-embedded-server-{}-{stamp}-{ordinal}",
                id()
            ));
            Self { root }
        }

        fn options(&self) -> EmbeddedServerOptions {
            EmbeddedServerOptions {
                listen: "127.0.0.1:0".to_owned(),
                database: self.root.join("storage/db/app.db"),
                blobs: self.root.join("storage/blobs"),
                models: self.root.join("models"),
                browser_bundle: Bundle::Directory(self.root.join("browser")),
                frontend: Frontend::from_assets(Arc::new(AppAssets)),
                processing: false,
            }
        }
    }

    impl Drop for Workspace {
        fn drop(&mut self) {
            let _ = remove_dir_all(&self.root);
        }
    }

    async fn read(url: &str) -> String {
        reqwest::get(url)
            .await
            .expect("the embedded server should answer")
            .text()
            .await
            .expect("the embedded response should be text")
    }

    #[tokio::test]
    async fn serves_the_app_and_the_api_from_the_shared_core() {
        let workspace = Workspace::new();
        let server = start_embedded(workspace.options())
            .await
            .expect("the embedded server should start");

        let shell = read(server.url()).await;
        let projects = read(&format!("{}/api/project/list", server.url())).await;

        assert!(workspace.root.join("storage/db/app.db").is_file());
        assert_eq!(shell, "<!doctype html><title>Musetric</title>");
        assert_eq!(projects, "[]");
        server.close();
    }
}
