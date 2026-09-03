use std::path::PathBuf;

use clap::Parser;
use musetric_server::{BoxedError, ServerOptions, TlsOptions, serve};

#[derive(Parser)]
#[command(about = "Musetric HTTP server")]
struct Arguments {
    #[arg(
        long,
        default_value = "127.0.0.1:0",
        help = "Address exposed to the browser or the public network."
    )]
    listen: String,

    #[arg(long, help = "SQLite database that holds the projects.")]
    database: PathBuf,

    #[arg(long, help = "Directory that holds the stored blobs.")]
    blobs: PathBuf,

    #[arg(long, help = "Bundled ffmpeg binary used to normalise uploaded audio.")]
    ffmpeg: PathBuf,

    #[arg(long, help = "Directory that holds the downloaded analysis models.")]
    models: PathBuf,

    #[arg(
        long,
        help = "Directory that holds the browser bundle of the gpu executor."
    )]
    browser_bundle: PathBuf,

    #[arg(long, help = "Directory that holds the built frontend.")]
    public: PathBuf,

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
        listen: arguments.listen,
        database: arguments.database,
        blobs: arguments.blobs,
        ffmpeg: arguments.ffmpeg,
        models: arguments.models,
        browser_bundle: arguments.browser_bundle,
        public: arguments.public,
        processing: arguments.processing,
        tls,
    })
    .await
}
