use std::path::PathBuf;

use clap::Parser;
use musetric_server::{BoxedError, ServerOptions, TlsOptions, serve};

#[derive(Parser)]
#[command(about = "Musetric HTTP proxy")]
struct Arguments {
    #[arg(
        long,
        help = "Address of the Fastify app that handles requests during the migration."
    )]
    upstream: String,

    #[arg(
        long,
        default_value = "127.0.0.1:0",
        help = "Address exposed to the browser or the public network."
    )]
    listen: String,

    #[arg(long, help = "SQLite database shared with the Fastify app.")]
    database: PathBuf,

    #[arg(long, help = "Directory that holds the stored blobs.")]
    blobs: PathBuf,

    #[arg(
        long,
        requires = "private_key",
        help = "PEM certificate for the public HTTPS listener."
    )]
    certificate: Option<PathBuf>,

    #[arg(
        long,
        requires = "certificate",
        help = "PEM private key for the public HTTPS listener."
    )]
    private_key: Option<PathBuf>,
}

#[tokio::main]
async fn main() -> Result<(), BoxedError> {
    let arguments = Arguments::parse();
    let tls = arguments
        .certificate
        .zip(arguments.private_key)
        .map(|(certificate, private_key)| TlsOptions {
            certificate,
            private_key,
        });
    serve(ServerOptions {
        upstream: arguments.upstream,
        listen: arguments.listen,
        database: arguments.database,
        blobs: arguments.blobs,
        tls,
    })
    .await
}
