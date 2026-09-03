use std::{io::Cursor, path::Path};

use axum::{
    body::Body,
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{CACHE_CONTROL, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE},
    },
    response::Response,
};
use musetric_db::blob_path;
use tokio::{
    fs::{File, metadata},
    io::{AsyncReadExt, AsyncSeekExt, SeekFrom},
};
use tokio_util::io::ReaderStream;

use crate::{
    cached_file::{CachedFile, CachedHeaders, DOWNLOAD_CACHE},
    failure::Failure,
    range::{ByteRange, parse},
    storage::Storage,
};

const NO_STORE: &str = "no-store";

pub(crate) struct CachedBlob {
    pub(crate) blob_id: String,
    pub(crate) filename: String,
    pub(crate) content_type: String,
    pub(crate) missing_message: String,
}

pub(crate) struct StoredBlob {
    pub(crate) blob_id: String,
    pub(crate) content_type: &'static str,
    pub(crate) missing_message: String,
}

pub(crate) async fn send_cached(
    storage: &Storage,
    request: &HeaderMap,
    blob: CachedBlob,
) -> Result<Response<Body>, Failure> {
    let path = blob_path(&storage.blobs_path, &blob.blob_id);
    let stat = metadata(&path)
        .await
        .map_err(|_| Failure::NotFound(blob.missing_message.clone()))?;
    let modified = stat
        .modified()
        .map_err(|_| Failure::NotFound(blob.missing_message))?;
    let size = stat.len();
    let file = CachedFile {
        filename: Some(blob.filename),
        content_type: blob.content_type,
        cache_control: DOWNLOAD_CACHE,
        size,
        modified,
    };
    let headers = CachedHeaders::create(&file).map_err(Failure::failed)?;
    if headers.is_not_modified(request) {
        return Ok(headers.respond_not_modified());
    }
    match parse(request, size) {
        ByteRange::Full => Ok(headers.respond(size, open_stream(&path).await?)),
        ByteRange::Unsatisfiable => unsatisfiable(size),
        ByteRange::Partial(range) => {
            let body = open_stream_at(&path, range.start, range.end).await?;
            headers
                .respond_partial(range, size, body)
                .map_err(Failure::failed)
        }
    }
}

pub(crate) async fn send_stored(
    storage: &Storage,
    blob: StoredBlob,
) -> Result<Response<Body>, Failure> {
    let path = blob_path(&storage.blobs_path, &blob.blob_id);
    let stat = metadata(&path)
        .await
        .map_err(|_| Failure::NotFound(blob.missing_message))?;
    let mut response = Response::new(open_stream(&path).await?);
    let headers = response.headers_mut();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static(blob.content_type));
    headers.insert(CONTENT_LENGTH, HeaderValue::from(stat.len()));
    headers.insert(CACHE_CONTROL, HeaderValue::from_static(NO_STORE));
    Ok(response)
}

pub(crate) fn send_generated(content_type: &'static str, content: Vec<u8>) -> Response<Body> {
    let stream = ReaderStream::new(Cursor::new(content));
    let mut response = Response::new(Body::from_stream(stream));
    let headers = response.headers_mut();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static(content_type));
    headers.insert(CACHE_CONTROL, HeaderValue::from_static(NO_STORE));
    response
}

async fn open_stream(path: &Path) -> Result<Body, Failure> {
    let content = File::open(path).await.map_err(Failure::failed)?;
    Ok(Body::from_stream(ReaderStream::new(content)))
}

async fn open_stream_at(path: &Path, start: u64, end: u64) -> Result<Body, Failure> {
    let mut content = File::open(path).await.map_err(Failure::failed)?;
    content
        .seek(SeekFrom::Start(start))
        .await
        .map_err(Failure::failed)?;
    let taken = content.take(end - start + 1);
    Ok(Body::from_stream(ReaderStream::new(taken)))
}

fn unsatisfiable(size: u64) -> Result<Response<Body>, Failure> {
    let range = HeaderValue::from_str(&format!("bytes */{size}"))
        .map_err(|_| Failure::failed("the unsatisfiable content range is invalid"))?;
    let mut response = Response::new(Body::empty());
    *response.status_mut() = StatusCode::RANGE_NOT_SATISFIABLE;
    response.headers_mut().insert(CONTENT_RANGE, range);
    Ok(response)
}
