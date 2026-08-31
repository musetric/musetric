use std::io::SeekFrom;
use std::path::{Path, PathBuf};

use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use tokio::fs;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::sync::mpsc::Sender;

const PARTIAL_SUFFIX: &str = ".part";
const MANIFEST_SUFFIX: &str = ".verified";
const ATTEMPTS: u32 = 3;
const RETRY_DELAY_MS: u64 = 1000;
const PROGRESS_STEP: u64 = 1 << 20;

pub struct DownloadRequest {
    pub url: String,
    pub sha256: String,
}

pub fn parse_request(body: &str) -> Option<(DownloadRequest, String)> {
    let mut lines = body.split('\n');
    let url = lines.next()?.trim().to_owned();
    let path = lines.next()?.trim().to_owned();
    let sha256 = lines.next()?.trim().to_owned();
    if url.is_empty() || path.is_empty() || sha256.is_empty() {
        return None;
    }
    Some((DownloadRequest { url, sha256 }, path))
}

fn suffixed(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}

async fn hash_file(path: &Path) -> Option<(String, u64)> {
    let mut file = fs::File::open(path).await.ok()?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    let mut size = 0u64;
    loop {
        let read = file.read(&mut buffer).await.ok()?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        size += read as u64;
    }
    Some((hex::encode(hasher.finalize()), size))
}

async fn cached_size(path: &Path, sha256: &str) -> Option<u64> {
    let metadata = fs::metadata(path).await.ok()?;
    let manifest = format!("size={} sha256={}", metadata.len(), sha256);
    let stored = fs::read_to_string(suffixed(path, MANIFEST_SUFFIX))
        .await
        .ok();
    if stored.as_deref() == Some(manifest.as_str()) {
        return Some(metadata.len());
    }
    let (actual, size) = hash_file(path).await?;
    if actual != sha256 {
        return None;
    }
    let _ = fs::write(suffixed(path, MANIFEST_SUFFIX), manifest).await;
    Some(size)
}

async fn partial_state(path: &Path) -> (u64, Sha256) {
    let empty = (0, Sha256::new());
    let Ok(mut file) = fs::File::open(path).await else {
        return empty;
    };
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    let mut size = 0u64;
    loop {
        let Ok(read) = file.read(&mut buffer).await else {
            return empty;
        };
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        size += read as u64;
    }
    (size, hasher)
}

async fn send(sender: &Sender<String>, line: String) {
    let _ = sender.send(line).await;
}

async fn run_attempt(
    request: &DownloadRequest,
    target: &Path,
    partial: &Path,
    sender: &Sender<String>,
) -> Result<u64, String> {
    let (mut downloaded, mut hasher) = partial_state(partial).await;
    let client = reqwest::Client::new();
    let mut builder = client.get(&request.url);
    if downloaded > 0 {
        builder = builder.header("range", format!("bytes={}-", downloaded));
    }
    let response = builder.send().await.map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    if response.status().as_u16() != 206 {
        downloaded = 0;
        hasher = Sha256::new();
    }
    let total = response
        .content_length()
        .map(|remaining| downloaded + remaining)
        .unwrap_or(0);

    let mut file = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .open(partial)
        .await
        .map_err(|error| error.to_string())?;
    file.set_len(downloaded)
        .await
        .map_err(|error| error.to_string())?;
    file.seek(SeekFrom::Start(downloaded))
        .await
        .map_err(|error| error.to_string())?;

    send(sender, format!("progress {} {}", downloaded, total)).await;

    let mut stream = response.bytes_stream();
    let mut reported = downloaded;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| error.to_string())?;
        hasher.update(&chunk);
        file.write_all(&chunk)
            .await
            .map_err(|error| error.to_string())?;
        downloaded += chunk.len() as u64;
        if downloaded - reported >= PROGRESS_STEP {
            reported = downloaded;
            send(sender, format!("progress {} {}", downloaded, total)).await;
        }
    }
    file.flush().await.map_err(|error| error.to_string())?;
    drop(file);

    let actual = hex::encode(hasher.finalize());
    if actual != request.sha256 {
        let _ = fs::remove_file(partial).await;
        return Err(format!(
            "checksum mismatch: expected {}, got {}",
            request.sha256, actual
        ));
    }
    fs::rename(partial, target)
        .await
        .map_err(|error| error.to_string())?;
    let _ = fs::write(
        suffixed(target, MANIFEST_SUFFIX),
        format!("size={} sha256={}", downloaded, request.sha256),
    )
    .await;
    Ok(downloaded)
}

pub async fn run_download(request: DownloadRequest, target: PathBuf, sender: Sender<String>) {
    if let Some(size) = cached_size(&target, &request.sha256).await {
        send(&sender, format!("done {} {} cached", size, size)).await;
        return;
    }
    let _ = fs::remove_file(&target).await;
    let _ = fs::remove_file(suffixed(&target, MANIFEST_SUFFIX)).await;
    if let Some(parent) = target.parent() {
        if let Err(error) = fs::create_dir_all(parent).await {
            send(&sender, format!("failed {}", error)).await;
            return;
        }
    }
    let partial = suffixed(&target, PARTIAL_SUFFIX);
    let mut last = String::new();
    for attempt in 1..=ATTEMPTS {
        match run_attempt(&request, &target, &partial, &sender).await {
            Ok(size) => {
                send(&sender, format!("done {} {} fresh", size, size)).await;
                return;
            }
            Err(error) => {
                last = error;
                if attempt < ATTEMPTS {
                    tokio::time::sleep(std::time::Duration::from_millis(
                        RETRY_DELAY_MS * attempt as u64,
                    ))
                    .await;
                }
            }
        }
    }
    send(&sender, format!("failed {}", last)).await;
}
