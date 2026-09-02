use std::{
    fmt::Write,
    path::{Path, PathBuf},
    time::{Duration, Instant, UNIX_EPOCH},
};

use reqwest::{
    Client, StatusCode,
    header::{HeaderValue, RANGE},
};
use sha2::{Digest, Sha256};
use tokio::{
    fs::{File, OpenOptions, create_dir_all, metadata, read_to_string, remove_file, rename, write},
    io::{AsyncReadExt, AsyncWriteExt},
    time::sleep,
};

use crate::host::BoxedError;

const PARTIAL_SUFFIX: &str = ".part";
const MANIFEST_SUFFIX: &str = ".verified";
const DOWNLOAD_ATTEMPTS: u32 = 3;
const RETRY_DELAY: Duration = Duration::from_secs(1);
const REPORT_INTERVAL: Duration = Duration::from_millis(200);
const READ_BUFFER_BYTE_LENGTH: usize = 64 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DownloadStatus {
    Processing,
    Cached,
    Done,
}

impl DownloadStatus {
    #[must_use]
    pub fn name(self) -> &'static str {
        match self {
            Self::Processing => "processing",
            Self::Cached => "cached",
            Self::Done => "done",
        }
    }
}

pub struct Download<'file> {
    pub label: &'file str,
    pub file: &'file str,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub status: DownloadStatus,
}

pub type DownloadReport<'report> = &'report (dyn Fn(&Download) + Send + Sync);

pub struct ModelFile {
    pub label: String,
    pub file: String,
    pub url: String,
    pub sha256: String,
    pub path: PathBuf,
}

pub async fn ensure_model_file(
    client: &Client,
    model: &ModelFile,
    report: DownloadReport<'_>,
) -> Result<PathBuf, BoxedError> {
    if let Some(size) = read_cached_size(model).await {
        report(&Download {
            label: &model.label,
            file: &model.file,
            downloaded: size,
            total: Some(size),
            status: DownloadStatus::Cached,
        });
        return Ok(model.path.clone());
    }
    let manifest_path = with_suffix(&model.path, MANIFEST_SUFFIX);
    let _ = remove_file(&model.path).await;
    let _ = remove_file(&manifest_path).await;
    if let Some(directory) = model.path.parent() {
        create_dir_all(directory).await?;
    }
    let partial_path = with_suffix(&model.path, PARTIAL_SUFFIX);
    download_with_retries(client, model, &partial_path, report).await?;
    rename(&partial_path, &model.path).await?;
    let size = metadata(&model.path).await?.len();
    write(
        &manifest_path,
        create_manifest(&model.path, &model.sha256).await?,
    )
    .await?;
    report(&Download {
        label: &model.label,
        file: &model.file,
        downloaded: size,
        total: Some(size),
        status: DownloadStatus::Done,
    });
    Ok(model.path.clone())
}

async fn download_with_retries(
    client: &Client,
    model: &ModelFile,
    partial_path: &Path,
    report: DownloadReport<'_>,
) -> Result<(), BoxedError> {
    let mut attempt = 1;
    loop {
        let outcome = run_download(client, model, partial_path, report).await;
        match outcome {
            Ok(()) => return Ok(()),
            Err(error) if attempt == DOWNLOAD_ATTEMPTS => return Err(error),
            Err(_) => sleep(RETRY_DELAY * attempt).await,
        }
        attempt += 1;
    }
}

async fn run_download(
    client: &Client,
    model: &ModelFile,
    partial_path: &Path,
    report: DownloadReport<'_>,
) -> Result<(), BoxedError> {
    let partial_size = metadata(partial_path).await.map_or(0, |stat| stat.len());
    let started = start_download(client, model, partial_size).await?;
    let mut hasher = Sha256::new();
    if started.resume_from > 0 {
        update_from_file(partial_path, &mut hasher).await?;
    }
    let mut file = open_partial(partial_path, started.resume_from).await?;
    let mut response = started.response;
    let mut downloaded = started.resume_from;
    let mut reported = Instant::now();
    report(&progress(model, downloaded, started.total));
    while let Some(chunk) = response.chunk().await? {
        hasher.update(&chunk);
        file.write_all(&chunk).await?;
        downloaded += u64::try_from(chunk.len())?;
        if reported.elapsed() >= REPORT_INTERVAL {
            reported = Instant::now();
            report(&progress(model, downloaded, started.total));
        }
    }
    file.flush().await?;
    report(&progress(model, downloaded, started.total));
    let digest = read_digest(hasher);
    if digest != model.sha256 {
        let _ = remove_file(partial_path).await;
        return Err(format!(
            "Downloaded {} checksum mismatch: expected {}, got {digest}",
            model.label, model.sha256
        )
        .into());
    }
    Ok(())
}

struct StartedDownload {
    response: reqwest::Response,
    resume_from: u64,
    total: Option<u64>,
}

async fn start_download(
    client: &Client,
    model: &ModelFile,
    partial_size: u64,
) -> Result<StartedDownload, BoxedError> {
    let mut request = client.get(&model.url);
    if partial_size > 0 {
        let range = HeaderValue::from_str(&format!("bytes={partial_size}-"))?;
        request = request.header(RANGE, range);
    }
    let response = request.send().await?;
    if !response.status().is_success() {
        return Err(format!(
            "Failed to download {}: HTTP {}",
            model.label,
            response.status().as_u16()
        )
        .into());
    }
    let resume_from = if response.status() == StatusCode::PARTIAL_CONTENT {
        partial_size
    } else {
        0
    };
    let total = response.content_length().map(|length| resume_from + length);
    Ok(StartedDownload {
        response,
        resume_from,
        total,
    })
}

async fn open_partial(partial_path: &Path, resume_from: u64) -> Result<File, BoxedError> {
    if resume_from > 0 {
        return Ok(OpenOptions::new().append(true).open(partial_path).await?);
    }
    Ok(File::create(partial_path).await?)
}

fn progress(model: &ModelFile, downloaded: u64, total: Option<u64>) -> Download<'_> {
    let finished = total.is_some_and(|value| downloaded >= value);
    Download {
        label: &model.label,
        file: &model.file,
        downloaded,
        total,
        status: if finished {
            DownloadStatus::Done
        } else {
            DownloadStatus::Processing
        },
    }
}

async fn read_cached_size(model: &ModelFile) -> Option<u64> {
    let stat = metadata(&model.path).await.ok()?;
    if !stat.is_file() {
        return None;
    }
    let manifest = create_manifest(&model.path, &model.sha256).await.ok()?;
    let manifest_path = with_suffix(&model.path, MANIFEST_SUFFIX);
    if read_to_string(&manifest_path).await.ok()? == manifest {
        return Some(stat.len());
    }
    let mut hasher = Sha256::new();
    update_from_file(&model.path, &mut hasher).await.ok()?;
    if read_digest(hasher) != model.sha256 {
        return None;
    }
    write(&manifest_path, manifest).await.ok()?;
    Some(stat.len())
}

async fn create_manifest(path: &Path, sha256: &str) -> Result<String, BoxedError> {
    let stat = metadata(path).await?;
    let modified = stat
        .modified()?
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_nanos();
    Ok(format!(
        "size={} modified={modified} sha256={sha256}",
        stat.len()
    ))
}

async fn update_from_file(path: &Path, hasher: &mut Sha256) -> Result<(), BoxedError> {
    let mut file = File::open(path).await?;
    let mut buffer = vec![0_u8; READ_BUFFER_BYTE_LENGTH];
    loop {
        let read = file.read(&mut buffer).await?;
        if read == 0 {
            return Ok(());
        }
        hasher.update(&buffer[..read]);
    }
}

fn read_digest(hasher: Sha256) -> String {
    hasher
        .finalize()
        .iter()
        .fold(String::new(), |mut text, byte| {
            let _ = write!(text, "{byte:02x}");
            text
        })
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}

#[cfg(test)]
mod tests {
    use std::{
        fs::{create_dir_all, read, read_to_string, remove_dir_all, write as write_file},
        net::SocketAddr,
        process::id,
        sync::{
            Arc, Mutex,
            atomic::{AtomicUsize, Ordering},
        },
        time::{SystemTime, UNIX_EPOCH},
    };

    use axum::{
        Router,
        body::Body,
        extract::State,
        http::{HeaderMap, StatusCode, header::RANGE},
        response::{IntoResponse, Response},
        routing::get,
    };
    use reqwest::Client;
    use tokio::{net::TcpListener, sync::oneshot};

    use super::{Download, DownloadStatus, ModelFile, ensure_model_file};

    const CONTENT: &[u8] = b"the fixture model bytes";
    const SHA256: &str = "015edf815f1917be874183c54bb97d63665f3942dcc22a0ac7e164804ea50e5d";

    static WORKSPACE_COUNT: AtomicUsize = AtomicUsize::new(0);

    struct Workspace {
        directory: std::path::PathBuf,
    }

    impl Workspace {
        fn new() -> Self {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("the clock should be after the epoch")
                .as_nanos();
            let ordinal = WORKSPACE_COUNT.fetch_add(1, Ordering::Relaxed);
            let directory =
                std::env::temp_dir().join(format!("musetric-cache-{}-{stamp}-{ordinal}", id()));
            create_dir_all(&directory).expect("the workspace should be created");
            Self { directory }
        }

        fn model_path(&self) -> std::path::PathBuf {
            self.directory.join("models").join("chordnet.onnx")
        }
    }

    impl Drop for Workspace {
        fn drop(&mut self) {
            let _ = remove_dir_all(&self.directory);
        }
    }

    #[derive(Clone)]
    struct Served {
        requests: Arc<AtomicUsize>,
        ranges: Arc<Mutex<Vec<String>>>,
    }

    async fn serve_content(State(state): State<Served>, headers: HeaderMap) -> Response {
        state.requests.fetch_add(1, Ordering::Relaxed);
        let range = headers
            .get(RANGE)
            .and_then(|value| value.to_str().ok())
            .map(ToOwned::to_owned);
        if let Some(asked) = range {
            state
                .ranges
                .lock()
                .expect("the range log should be writable")
                .push(asked.clone());
            let from: usize = asked
                .trim_start_matches("bytes=")
                .trim_end_matches('-')
                .parse()
                .expect("the range should be readable");
            return (
                StatusCode::PARTIAL_CONTENT,
                Body::from(CONTENT[from..].to_vec()),
            )
                .into_response();
        }
        (StatusCode::OK, Body::from(CONTENT.to_vec())).into_response()
    }

    async fn start_source() -> (SocketAddr, Served, oneshot::Sender<()>) {
        let state = Served {
            requests: Arc::new(AtomicUsize::new(0)),
            ranges: Arc::new(Mutex::new(Vec::new())),
        };
        let application = Router::new()
            .route("/model", get(serve_content))
            .with_state(state.clone());
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("the source should bind");
        let address = listener
            .local_addr()
            .expect("the source should have an address");
        let (shutdown, stopped) = oneshot::channel();
        tokio::spawn(async move {
            let _ = axum::serve(listener, application)
                .with_graceful_shutdown(async move {
                    let _ = stopped.await;
                })
                .await;
        });
        (address, state, shutdown)
    }

    struct Reported {
        seen: Arc<Mutex<Vec<(u64, DownloadStatus)>>>,
    }

    impl Reported {
        fn create() -> Self {
            Self {
                seen: Arc::new(Mutex::new(Vec::new())),
            }
        }

        fn sink(&self) -> Box<dyn Fn(&Download) + Send + Sync> {
            let seen = Arc::clone(&self.seen);
            Box::new(move |download: &Download| {
                seen.lock()
                    .expect("the download log should be writable")
                    .push((download.downloaded, download.status));
            })
        }

        fn statuses(&self) -> Vec<DownloadStatus> {
            self.seen
                .lock()
                .expect("the download log should be readable")
                .iter()
                .map(|entry| entry.1)
                .collect()
        }
    }

    fn create_model(workspace: &Workspace, address: SocketAddr, sha256: &str) -> ModelFile {
        ModelFile {
            label: "Chord recognition model".to_owned(),
            file: "chordnet.onnx".to_owned(),
            url: format!("http://{address}/model"),
            sha256: sha256.to_owned(),
            path: workspace.model_path(),
        }
    }

    #[tokio::test]
    async fn downloads_a_model_file_and_records_its_manifest() {
        let workspace = Workspace::new();
        let (address, served, shutdown) = start_source().await;
        let reported = Reported::create();
        let model = create_model(&workspace, address, SHA256);

        let path = ensure_model_file(&Client::new(), &model, reported.sink().as_ref())
            .await
            .expect("the model should download");

        assert_eq!(read(&path).expect("the model should be stored"), CONTENT);
        assert!(
            read_to_string(format!("{}.verified", path.display()))
                .expect("the manifest should be written")
                .contains(SHA256)
        );
        assert_eq!(served.requests.load(Ordering::Relaxed), 1);
        assert_eq!(
            reported.statuses().last(),
            Some(&DownloadStatus::Done),
            "the last report should say the file is ready"
        );
        let _ = shutdown.send(());
    }

    #[tokio::test]
    async fn answers_from_the_cache_without_asking_again() {
        let workspace = Workspace::new();
        let (address, served, shutdown) = start_source().await;
        let reported = Reported::create();
        let model = create_model(&workspace, address, SHA256);
        let client = Client::new();

        ensure_model_file(&client, &model, reported.sink().as_ref())
            .await
            .expect("the model should download");
        let second = Reported::create();
        ensure_model_file(&client, &model, second.sink().as_ref())
            .await
            .expect("the model should come from the cache");

        assert_eq!(served.requests.load(Ordering::Relaxed), 1);
        assert_eq!(second.statuses(), vec![DownloadStatus::Cached]);
        let _ = shutdown.send(());
    }

    #[tokio::test]
    async fn resumes_a_download_that_was_cut_short() {
        let workspace = Workspace::new();
        let (address, served, shutdown) = start_source().await;
        let reported = Reported::create();
        let model = create_model(&workspace, address, SHA256);
        create_dir_all(model.path.parent().expect("a parent"))
            .expect("the model directory should be created");
        write_file(format!("{}.part", model.path.display()), &CONTENT[..7])
            .expect("the partial file should be written");

        let path = ensure_model_file(&Client::new(), &model, reported.sink().as_ref())
            .await
            .expect("the model should finish");

        assert_eq!(read(&path).expect("the model should be stored"), CONTENT);
        assert_eq!(
            served
                .ranges
                .lock()
                .expect("the range log should be readable")
                .as_slice(),
            ["bytes=7-"]
        );
        let _ = shutdown.send(());
    }

    #[tokio::test]
    async fn refuses_a_file_that_does_not_match_its_checksum() {
        let workspace = Workspace::new();
        let (address, _served, shutdown) = start_source().await;
        let reported = Reported::create();
        let model = create_model(&workspace, address, &"0".repeat(64));

        let refused = ensure_model_file(&Client::new(), &model, reported.sink().as_ref())
            .await
            .expect_err("the model should be refused");

        assert!(
            refused
                .to_string()
                .starts_with("Downloaded Chord recognition model checksum mismatch"),
            "unexpected refusal: {refused}"
        );
        assert!(!model.path.exists());
        let _ = shutdown.send(());
    }
}
