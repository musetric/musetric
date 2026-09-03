use std::{
    io::{self, Write},
    net::{SocketAddr, TcpListener as StdTcpListener},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};

use axum_server::{Handle, tls_rustls::RustlsConfig};
use musetric_db::{BoxedError, MigrationFailure, MigrationReport, Reader, Writer, init_database};
use musetric_jobs::{Queue, QueueOptions};
use musetric_media::Tools;
use reqwest::Client;
use serde_json::{Map, Value, json};
use tokio::{
    io::{stdin, stdout},
    net::TcpListener,
    sync::oneshot,
};

use crate::{
    analysis::{AnalysisContext, AnalysisRunner},
    frontend::Frontend,
    garbage::spawn_collector,
    host::HostProcess,
    router::{RouterOptions, create_router},
    storage::Storage,
};

const READY_PREFIX: &str = "MUSETRIC_PROXY_URL=";
const MIGRATION_PREFIX: &str = "MUSETRIC_MIGRATION=";
const MIGRATION_FAILED_PREFIX: &str = "MUSETRIC_MIGRATION_FAILED=";
const ADDRESS_IN_USE: &str = "MUSETRIC_PROXY_ERROR=address-in-use";
const SHUTDOWN_GRACE: Duration = Duration::from_secs(5);
const PROCESSING_INTERVAL: Duration = Duration::from_secs(10);

pub struct ServerOptions {
    pub listen: String,
    pub database: PathBuf,
    pub blobs: PathBuf,
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
    pub models: PathBuf,
    pub browser_bundle: PathBuf,
    pub public: PathBuf,
    pub processing: bool,
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
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
    pub models: PathBuf,
    pub browser_bundle: PathBuf,
    pub frontend: Frontend,
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
    let (host, closed) = HostProcess::create(stdin(), stdout());
    match init_database(&options.database) {
        Ok(report) => announce_migration(&host, &report),
        Err(failure) => {
            announce_migration_failure(&host, &failure);
            return Err(failure.into());
        }
    }
    let storage = create_storage(
        &options.database,
        options.blobs,
        options.ffmpeg,
        options.ffprobe,
    )?;
    let runner = AnalysisRunner::create(AnalysisContext {
        storage: Arc::clone(&storage),
        host: Arc::clone(&host),
        client: Client::new(),
        models_path: options.models,
        bundle_path: options.browser_bundle,
    });
    let queue = Queue::create(QueueOptions {
        reader: Arc::clone(&storage.database),
        writer: Arc::clone(&storage.writer),
        runner: Arc::new(runner),
        interval: PROCESSING_INTERVAL,
    });
    if options.processing {
        queue.spawn();
    }
    let app = create_router(RouterOptions {
        frontend: Frontend::from_directory(options.public),
        storage,
        queue,
    });
    let socket = bind(&options.listen)?;
    let address = socket.local_addr()?;
    if let Some(tls) = options.tls {
        let config = RustlsConfig::from_pem_file(tls.certificate, tls.private_key).await?;
        let handle = Handle::<SocketAddr>::new();
        tokio::spawn(shutdown_on_closed_host(handle.clone(), closed));
        announce_ready(&host, "https", address);
        axum_server::from_tcp_rustls(socket, config)?
            .handle(handle)
            .serve(app.into_make_service())
            .await?;
        return Ok(());
    }
    let listener = TcpListener::from_std(socket)?;
    announce_ready(&host, "http", address);
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            let _ = closed.await;
        })
        .await?;
    Ok(())
}

pub async fn start_embedded(options: EmbeddedServerOptions) -> Result<EmbeddedServer, BoxedError> {
    if let Some(parent) = options.database.parent() {
        std::fs::create_dir_all(parent)?;
    }
    init_database(&options.database)?;
    let storage = create_storage(
        &options.database,
        options.blobs,
        options.ffmpeg,
        options.ffprobe,
    )?;
    let runner = AnalysisRunner::create(AnalysisContext {
        storage: Arc::clone(&storage),
        host: HostProcess::unavailable(),
        client: Client::new(),
        models_path: options.models,
        bundle_path: options.browser_bundle,
    });
    let queue = Queue::create(QueueOptions {
        reader: Arc::clone(&storage.database),
        writer: Arc::clone(&storage.writer),
        runner: Arc::new(runner),
        interval: PROCESSING_INTERVAL,
    });
    let app = create_router(RouterOptions {
        frontend: options.frontend,
        storage,
        queue,
    });
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

fn create_storage(
    database: &Path,
    blobs: PathBuf,
    ffmpeg: PathBuf,
    ffprobe: PathBuf,
) -> Result<Arc<Storage>, BoxedError> {
    let storage = Arc::new(Storage {
        database: Arc::new(Reader::open(database)?),
        writer: Arc::new(Writer::open(database)?),
        blobs_path: blobs,
        tools: Tools { ffmpeg, ffprobe },
    });
    spawn_collector(Arc::clone(&storage));
    Ok(storage)
}

fn bind(listen: &str) -> Result<StdTcpListener, BoxedError> {
    let listener = StdTcpListener::bind(listen).map_err(report_bind_failure)?;
    listener.set_nonblocking(true)?;
    Ok(listener)
}

fn report_bind_failure(error: io::Error) -> io::Error {
    if error.kind() == io::ErrorKind::AddrInUse {
        let _ = writeln!(io::stderr().lock(), "{ADDRESS_IN_USE}");
    }
    error
}

fn announce_ready(host: &HostProcess, protocol: &str, address: SocketAddr) {
    host.announce(&format!("{READY_PREFIX}{protocol}://{address}"));
}

fn announce_migration(host: &HostProcess, report: &MigrationReport) {
    let mut described = Map::new();
    described.insert("fromVersion".to_owned(), json!(report.from_version));
    described.insert("toVersion".to_owned(), json!(report.to_version));
    insert_backup(&mut described, report.backup_path.as_deref());
    host.announce(&format!("{MIGRATION_PREFIX}{}", Value::Object(described)));
}

fn announce_migration_failure(host: &HostProcess, failure: &MigrationFailure) {
    let mut described = Map::new();
    described.insert("message".to_owned(), json!(failure.to_string()));
    if let Some(version) = failure.committed_version() {
        described.insert("committedVersion".to_owned(), json!(version));
    }
    insert_backup(&mut described, failure.backup_path());
    host.announce(&format!(
        "{MIGRATION_FAILED_PREFIX}{}",
        Value::Object(described)
    ));
}

fn insert_backup(described: &mut Map<String, Value>, backup_path: Option<&std::path::Path>) {
    if let Some(path) = backup_path {
        described.insert("backupPath".to_owned(), json!(path));
    }
}

async fn shutdown_on_closed_host(handle: Handle<SocketAddr>, closed: oneshot::Receiver<()>) {
    let _ = closed.await;
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
    use crate::{Frontend, FrontendAsset, FrontendAssets};

    static WORKSPACE_COUNT: AtomicUsize = AtomicUsize::new(0);

    struct Assets;

    impl FrontendAssets for Assets {
        fn get(&self, path: &str) -> Option<FrontendAsset> {
            (path == "index.html").then(|| {
                FrontendAsset::new(
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
                ffmpeg: self.root.join("runtime/ffmpeg"),
                ffprobe: self.root.join("runtime/ffprobe"),
                models: self.root.join("models"),
                browser_bundle: self.root.join("browser"),
                frontend: Frontend::from_assets(Arc::new(Assets)),
            }
        }
    }

    impl Drop for Workspace {
        fn drop(&mut self) {
            let _ = remove_dir_all(&self.root);
        }
    }

    #[tokio::test]
    async fn serves_embedded_assets_from_the_shared_core() {
        let workspace = Workspace::new();
        let server = start_embedded(workspace.options())
            .await
            .expect("the embedded server should start");
        let response = reqwest::get(server.url())
            .await
            .expect("the embedded server should answer");
        let body = response
            .text()
            .await
            .expect("the embedded response should be text");

        assert!(workspace.root.join("storage/db/app.db").is_file());
        assert_eq!(body, "<!doctype html><title>Musetric</title>");
        server.close();
    }
}
