use std::{
    io::{self, Write},
    net::{SocketAddr, TcpListener as StdTcpListener},
    path::PathBuf,
    sync::Arc,
    time::Duration,
};

use axum_server::{Handle, tls_rustls::RustlsConfig};
use musetric_db::{BoxedError, Reader, Writer};
use musetric_media::Tools;
use tokio::{io::AsyncReadExt, net::TcpListener};

use crate::{garbage::spawn_collector, router::create_router, storage::Storage};

const READY_PREFIX: &str = "MUSETRIC_PROXY_URL=";
const ADDRESS_IN_USE: &str = "MUSETRIC_PROXY_ERROR=address-in-use";
const SHUTDOWN_GRACE: Duration = Duration::from_secs(5);

pub struct ServerOptions {
    pub upstream: String,
    pub listen: String,
    pub database: PathBuf,
    pub blobs: PathBuf,
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
    pub tls: Option<TlsOptions>,
}

pub struct TlsOptions {
    pub certificate: PathBuf,
    pub private_key: PathBuf,
}

pub async fn serve(options: ServerOptions) -> Result<(), BoxedError> {
    let storage = Arc::new(Storage {
        database: Reader::open(&options.database)?,
        writer: Writer::open(&options.database)?,
        blobs_path: options.blobs,
        tools: Tools {
            ffmpeg: options.ffmpeg,
            ffprobe: options.ffprobe,
        },
    });
    spawn_collector(Arc::clone(&storage));
    let app = create_router(options.upstream.parse()?, storage);
    let socket = bind(&options.listen)?;
    let address = socket.local_addr()?;
    if let Some(tls) = options.tls {
        let config = RustlsConfig::from_pem_file(tls.certificate, tls.private_key).await?;
        let handle = Handle::<SocketAddr>::new();
        tokio::spawn(shutdown_on_closed_stdin(handle.clone()));
        print_ready("https", address)?;
        axum_server::from_tcp_rustls(socket, config)?
            .handle(handle)
            .serve(app.into_make_service())
            .await?;
        return Ok(());
    }
    let listener = TcpListener::from_std(socket)?;
    print_ready("http", address)?;
    axum::serve(listener, app)
        .with_graceful_shutdown(closed_stdin())
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

fn print_ready(protocol: &str, address: SocketAddr) -> io::Result<()> {
    let mut stdout = io::stdout().lock();
    writeln!(stdout, "{READY_PREFIX}{protocol}://{address}")?;
    stdout.flush()
}

async fn closed_stdin() {
    let mut stdin = tokio::io::stdin();
    let mut buffer = [0_u8; 256];
    while let Ok(read) = stdin.read(&mut buffer).await {
        if read == 0 {
            return;
        }
    }
}

async fn shutdown_on_closed_stdin(handle: Handle<SocketAddr>) {
    closed_stdin().await;
    handle.graceful_shutdown(Some(SHUTDOWN_GRACE));
}
