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

    #[arg(long, help = "Bundled ffmpeg binary used to normalise uploaded audio.")]
    ffmpeg: PathBuf,

    #[arg(long, help = "Bundled ffprobe binary used to measure uploaded audio.")]
    ffprobe: PathBuf,

    #[arg(long, help = "Directory that holds the downloaded analysis models.")]
    models: PathBuf,

    #[arg(
        long,
        help = "Directory that holds the browser bundle of the gpu executor."
    )]
    browser_bundle: PathBuf,

    #[arg(
        long,
        default_value_t = true,
        num_args = 1,
        help = "Run the processing queue that turns uploaded songs into analyses."
    )]
    processing: bool,

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
        ffmpeg: arguments.ffmpeg,
        ffprobe: arguments.ffprobe,
        models: arguments.models,
        browser_bundle: arguments.browser_bundle,
        processing: arguments.processing,
        tls,
    })
    .await
}
