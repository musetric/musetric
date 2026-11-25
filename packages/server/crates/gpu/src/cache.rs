use std::{
    error::Error,
    fmt::{Display, Formatter, Write},
    path::{Path, PathBuf},
    time::{Duration, Instant, UNIX_EPOCH},
};

use reqwest::{
    Certificate, Client, StatusCode,
    header::{HeaderValue, RANGE},
};
use sha2::{Digest, Sha256};
use tokio::{
    fs::{File, OpenOptions, create_dir_all, metadata, read_to_string, remove_file, rename, write},
    io::{AsyncReadExt, AsyncWriteExt},
    time::sleep,
};

use crate::host::BoxedError;

pub fn create_client() -> Result<Client, BoxedError> {
    let roots = webpki_root_certs::TLS_SERVER_ROOT_CERTS
        .iter()
        .map(|certificate| Certificate::from_der(certificate))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Client::builder()
        .tls_certs_only(roots)
        .read_timeout(STALL_LIMIT)
        .build()?)
}

const STALL_LIMIT: Duration = Duration::from_secs(30);
const PARTIAL_SUFFIX: &str = ".part";
const MANIFEST_SUFFIX: &str = ".verified";
const DOWNLOAD_ATTEMPTS: u32 = 3;
const RETRY_DELAY: Duration = Duration::from_secs(1);
const REPORT_INTERVAL: Duration = Duration::from_millis(200);
const READ_BUFFER_BYTE_LENGTH: usize = 64 * 1024;
const SPACE_RESERVE: u64 = 256 * 1024 * 1024;
const MEGABYTE: u64 = 1024 * 1024;

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
            Err(error) if attempt == DOWNLOAD_ATTEMPTS || error.is::<NoRoom>() => {
                return Err(error);
            }
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
    if let Some(total) = started.total {
        ensure_room(model, partial_path, total - started.resume_from)?;
    }
    let mut hasher = Sha256::new();
    if started.resume_from > 0 {
        update_from_file(partial_path, &mut hasher).await?;
    }
    let mut file = open_partial(partial_path, started.resume_from).await?;
    let mut response = started.response;
    let mut downloaded = started.resume_from;
    let mut reported = Instant::now();
    report(&progress(model, downloaded, started.total));
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| describe_failure(model, error))?
    {
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
    let response = request
        .send()
        .await
        .map_err(|error| describe_failure(model, error))?;
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

fn describe_failure(model: &ModelFile, error: reqwest::Error) -> BoxedError {
    if error.is_timeout() {
        return format!("Failed to download {}: the download stalled", model.label).into();
    }
    if error.is_connect() {
        return format!(
            "Failed to download {}: no connection. Check the internet and retry",
            model.label
        )
        .into();
    }
    error.without_url().into()
}

fn ensure_room(model: &ModelFile, partial_path: &Path, needed: u64) -> Result<(), BoxedError> {
    let directory = partial_path
        .parent()
        .ok_or("The model path has no directory")?;
    let available = fs4::available_space(directory)?;
    if needed.saturating_add(SPACE_RESERVE) <= available {
        return Ok(());
    }
    Err(NoRoom(format!(
        "Not enough free space to download {}: it needs {} MB more, and {} MB are free",
        model.label,
        needed.div_ceil(MEGABYTE),
        available / MEGABYTE
    ))
    .into())
}

#[derive(Debug)]
struct NoRoom(String);

impl Display for NoRoom {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl Error for NoRoom {}

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

#[must_use]
pub fn kept_files(model: &ModelFile) -> [PathBuf; 3] {
    [
        model.path.clone(),
        with_suffix(&model.path, MANIFEST_SUFFIX),
        with_suffix(&model.path, PARTIAL_SUFFIX),
    ]
}

pub async fn has_verified_copy(model: &ModelFile) -> bool {
    read_cached_size(model).await.is_some()
}

async fn read_cached_size(model: &ModelFile) -> Option<u64> {
    let stat = metadata(&model.path).await.ok()?;
    if !stat.is_file() {
        return None;
    }
    let manifest = create_manifest(&model.path, &model.sha256).await.ok()?;
    let manifest_path = with_suffix(&model.path, MANIFEST_SUFFIX);
    if read_to_string(&manifest_path)
        .await
        .is_ok_and(|stored| stored == manifest)
    {
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
