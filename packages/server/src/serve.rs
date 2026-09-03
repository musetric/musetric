use std::{
    io::{self, Write},
    net::{SocketAddr, TcpListener as StdTcpListener},
    path::PathBuf,
    sync::Arc,
    time::Duration,
};

use axum_server::{Handle, tls_rustls::RustlsConfig};
use musetric_db::{BoxedError, Reader, Writer};
use musetric_jobs::{Queue, QueueOptions};
use musetric_media::Tools;
use reqwest::Client;
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
    proxy::ProxyState,
    router::{RouterOptions, create_router},
    storage::Storage,
};

const READY_PREFIX: &str = "MUSETRIC_PROXY_URL=";
const ADDRESS_IN_USE: &str = "MUSETRIC_PROXY_ERROR=address-in-use";
const SHUTDOWN_GRACE: Duration = Duration::from_secs(5);
const PROCESSING_INTERVAL: Duration = Duration::from_secs(10);

pub struct ServerOptions {
    pub upstream: String,
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
    let (host, closed) = HostProcess::create(stdin(), stdout());
    let proxy = ProxyState::create(options.upstream.parse()?);
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
        proxy,
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

async fn shutdown_on_closed_host(handle: Handle<SocketAddr>, closed: oneshot::Receiver<()>) {
    let _ = closed.await;
    handle.graceful_shutdown(Some(SHUTDOWN_GRACE));
}
