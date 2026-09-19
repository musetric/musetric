use std::{
    fs::create_dir_all,
    io::{self, Write},
    net::{SocketAddr, TcpListener as StdTcpListener},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::Router;
use axum_server::{Handle, tls_rustls::RustlsConfig};
use musetric_db::{
    BoxedError, MigrationFailure, MigrationReport, Reader, Writer, init_database, lock_storage,
};
use musetric_gpu::{Bundle, ExecutorHost, create_client};
use musetric_jobs::{Queue, QueueOptions};
use musetric_media::SymphoniaPcm;
use rcgen::generate_simple_self_signed;
use tokio::{net::TcpListener, sync::oneshot};

use crate::{
    analysis::{AnalysisContext, AnalysisRunner},
    executor_browser::{ExecutorBrowser, ExecutorBrowserOptions, find_browser},
    frontend::Frontend,
    garbage::spawn_collector,
    publish::Publication,
    router::{RouterOptions, create_router},
    storage::Storage,
};

const SHUTDOWN_GRACE: Duration = Duration::from_secs(5);
const PROCESSING_INTERVAL: Duration = Duration::from_secs(10);
const STEP_IDLE_LIMIT: Duration = Duration::from_mins(10);
const NO_BROWSER: &str =
    "No Chrome, Edge or Chromium was found to run the gpu executor; pass --browser";

pub struct ServerOptions {
    pub listen: String,
    pub database: PathBuf,
    pub blobs: PathBuf,
    pub work: PathBuf,
    pub models: PathBuf,
    pub browser_bundle: PathBuf,
    pub public: PathBuf,
    pub processing: bool,
    pub tls_self_signed: bool,
    pub tls: Option<TlsOptions>,
    pub browser: Option<PathBuf>,
}

pub struct TlsOptions {
    pub certificate: PathBuf,
    pub private_key: PathBuf,
}

pub struct EmbeddedServerOptions {
    pub listen: String,
    pub database: PathBuf,
    pub blobs: PathBuf,
    pub work: PathBuf,
    pub models: PathBuf,
    pub browser_bundle: Bundle,
    pub frontend: Frontend,
    pub processing: bool,
}

pub struct EmbeddedServer {
    url: String,
    executor_url: String,
    shutdown: Mutex<Option<oneshot::Sender<()>>>,
}

impl EmbeddedServer {
    #[must_use]
    pub fn url(&self) -> &str {
        &self.url
    }

    #[must_use]
    pub fn executor_url(&self) -> &str {
        &self.executor_url
    }

    pub fn close(&self) {
        let sender = self.shutdown.lock().ok().and_then(|mut guard| guard.take());
        if let Some(shutdown) = sender {
            let _ = shutdown.send(());
        }
    }
}

pub async fn serve(options: ServerOptions) -> Result<(), BoxedError> {
    let Some(_storage_lock) = lock_storage(&options.database)? else {
        return Err(format!(
            "Another Musetric server is using the database {}",
            options.database.display()
        )
        .into());
    };
    match init_database(&options.database) {
        Ok(report) => announce_migration(&report),
        Err(failure) => {
            report_migration_failure(&failure);
            return Err(failure.into());
        }
    }
    let browser = match (options.processing, options.browser) {
        (false, _) => None,
        (true, Some(path)) => Some(path),
        (true, None) => Some(find_browser().ok_or(NO_BROWSER)?),
    };
    let work = options.work.clone();
    let storage = create_storage(&options.database, options.blobs, options.work)?;
    let CreatedApp {
        router: app,
        executor_url,
    } = create_app(AppOptions {
        storage,
        models: options.models,
        browser_bundle: Bundle::Directory(options.browser_bundle),
        frontend: Frontend::from_directory(options.public),
        processing: options.processing,
    })
    .await?;
    let _browser = browser
        .map(|executable| {
            ExecutorBrowser::start(ExecutorBrowserOptions {
                executable,
                work,
                url: executor_url,
            })
        })
        .transpose()?;
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
        tokio::spawn(shutdown_on_signal(handle.clone()));
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
        .with_graceful_shutdown(stop_requested())
        .await?;
    Ok(())
}

pub async fn start_embedded(options: EmbeddedServerOptions) -> Result<EmbeddedServer, BoxedError> {
    init_database(&options.database)?;
    let storage = create_storage(&options.database, options.blobs, options.work)?;
    let app = create_app(AppOptions {
        storage,
        models: options.models,
        browser_bundle: options.browser_bundle,
        frontend: options.frontend,
        processing: options.processing,
    })
    .await?;
    let socket = bind(&options.listen)?;
    let address = socket.local_addr()?;
    let listener = TcpListener::from_std(socket)?;
    let (shutdown, closed) = oneshot::channel();
    let CreatedApp {
        router,
        executor_url,
    } = app;
    tokio::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                let _ = closed.await;
            })
            .await;
    });
    Ok(EmbeddedServer {
        url: format!("http://{address}"),
        executor_url,
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

struct CreatedApp {
    router: Router,
    executor_url: String,
}

async fn create_app(options: AppOptions) -> Result<CreatedApp, BoxedError> {
    let storage = options.storage;
    let host = ExecutorHost::start(options.browser_bundle).await?;
    let runner = AnalysisRunner::create(AnalysisContext {
        storage: Arc::clone(&storage),
        client: create_client()?,
        models_path: options.models.clone(),
        host: Arc::clone(&host),
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
        wake_on_arrival(&host, &queue);
    }
    let executor_url = host.base_url().to_owned();
    let router = create_router(RouterOptions {
        frontend: options.frontend,
        storage,
        queue,
        models_path: options.models,
    });
    Ok(CreatedApp {
        router,
        executor_url,
    })
}

fn wake_on_arrival(host: &ExecutorHost, queue: &Arc<Queue>) {
    let mut arrivals = host.arrivals();
    let waking = Arc::clone(queue);
    tokio::spawn(async move {
        while arrivals.next().await {
            waking.wake();
        }
    });
}

#[cfg(unix)]
async fn stop_requested() {
    use tokio::signal::unix::{SignalKind, signal};
    let Ok(mut terminate) = signal(SignalKind::terminate()) else {
        let _ = tokio::signal::ctrl_c().await;
        return;
    };
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        _ = terminate.recv() => {}
    }
}

#[cfg(not(unix))]
async fn stop_requested() {
    let _ = tokio::signal::ctrl_c().await;
}

fn announce(line: &str) {
    let _ = writeln!(io::stdout().lock(), "{line}");
}

fn create_storage(
    database: &Path,
    blobs: PathBuf,
    work: PathBuf,
) -> Result<Arc<Storage>, BoxedError> {
    let writer = Writer::open(database)?;
    writer.abandon_running_steps()?;
    create_dir_all(&work)?;
    let storage = Arc::new(Storage {
        database: Arc::new(Reader::open(database)?),
        writer: Arc::new(writer),
        blobs_path: blobs,
        work_path: work,
        pcm: Arc::new(SymphoniaPcm),
        publication: Publication::default(),
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
    announce(&format!("Musetric is listening on {protocol}://{address}"));
}

fn announce_migration(report: &MigrationReport) {
    if report.from_version == report.to_version {
        return;
    }
    let moved = format!(
        "The database moved from version {} to {}",
        report.from_version, report.to_version
    );
    match &report.backup_path {
        Some(path) => announce(&format!(
            "{moved}; the previous copy is in {}",
            path.display()
        )),
        None => announce(&moved),
    }
}

fn report_migration_failure(failure: &MigrationFailure) {
    let mut lines = vec![failure.to_string()];
    if let Some(version) = failure.committed_version() {
        lines.push(format!("The database stays at version {version}."));
    }
    if let Some(path) = failure.backup_path() {
        lines.push(format!(
            "A copy from before the update is in {}.",
            path.display()
        ));
    }
    let _ = writeln!(io::stderr().lock(), "{}", lines.join("\n"));
}

async fn shutdown_on_signal(handle: Handle<SocketAddr>) {
    stop_requested().await;
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

    use musetric_db::{OpenOptions, init_database, lock_storage, open_database};

    use super::{EmbeddedServerOptions, ServerOptions, serve, start_embedded};
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
                work: self.root.join("storage/work"),
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

    #[tokio::test]
    async fn leaves_the_storage_of_a_running_server_untouched() {
        let workspace = Workspace::new();
        let database = workspace.root.join("storage/db/app.db");
        init_database(&database).expect("the database should be created");
        let options = OpenOptions {
            foreign_keys: false,
        };
        open_database(&database, &options)
            .expect("the database should open")
            .execute_batch(
                "INSERT INTO Project (id, name, sampleRate, frameCount)
                 VALUES (1, 'Fixture project', 48000, 480000);
                 INSERT INTO ProcessingStep (projectId, step, status)
                 VALUES (1, 'separation', 'processing');",
            )
            .expect("the running step should be seeded");
        let first = lock_storage(&database)
            .expect("the lock should open")
            .expect("the first server should hold the storage");
        let port = std::net::TcpListener::bind("127.0.0.1:0").expect("the port should bind");
        let listen = port
            .local_addr()
            .expect("the port should have an address")
            .to_string();

        let refused = serve(ServerOptions {
            listen,
            database: database.clone(),
            blobs: workspace.root.join("storage/blobs"),
            work: workspace.root.join("storage/work"),
            models: workspace.root.join("models"),
            browser_bundle: workspace.root.join("browser"),
            public: workspace.root.join("public"),
            processing: false,
            tls_self_signed: false,
            tls: None,
            browser: None,
        })
        .await;
        let status: String = open_database(&database, &options)
            .expect("the database should open")
            .query_row(
                "SELECT status FROM ProcessingStep WHERE projectId = 1 AND step = 'separation'",
                [],
                |row| row.get(0),
            )
            .expect("the step should be readable");
        drop(first);

        assert!(refused.is_err());
        assert_eq!(status, "processing");
    }
}
