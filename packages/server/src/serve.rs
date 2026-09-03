use std::{
    io::{self, Write},
    net::{SocketAddr, TcpListener as StdTcpListener},
    path::PathBuf,
    sync::Arc,
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

pub async fn serve(options: ServerOptions) -> Result<(), BoxedError> {
    let (host, closed) = HostProcess::create(stdin(), stdout());
    match init_database(&options.database) {
        Ok(report) => announce_migration(&host, &report),
        Err(failure) => {
            announce_migration_failure(&host, &failure);
            return Err(failure.into());
        }
    }
    let storage = Arc::new(Storage {
        database: Arc::new(Reader::open(&options.database)?),
        writer: Arc::new(Writer::open(&options.database)?),
        blobs_path: options.blobs,
        tools: Tools {
            ffmpeg: options.ffmpeg,
            ffprobe: options.ffprobe,
        },
    });
    spawn_collector(Arc::clone(&storage));
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
        frontend: Frontend::create(options.public),
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
