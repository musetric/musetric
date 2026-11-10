use std::{
    path::{Component, Path, PathBuf},
    sync::Arc,
};

use axum::{
    body::Body,
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{CACHE_CONTROL, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE},
    },
    response::Response,
};
use tokio::{
    fs::{File, metadata},
    io::{AsyncReadExt, AsyncSeekExt, SeekFrom},
};
use tokio_util::io::ReaderStream;

use crate::range::{ByteRange, parse};

pub(crate) const LOADER_HTML: &str = concat!(
    "<!doctype html><html><head><meta charset=\"utf-8\"></head><body>",
    "<script type=\"module\" src=\"/index.js\"></script>",
    "</body></html>"
);
pub(crate) const NO_STORE: &str = "no-store";
const IMMUTABLE: &str = "public, max-age=31536000, immutable";
const HASHED_ASSETS: &str = "assets/";
pub(crate) const OCTET_STREAM: &str = "application/octet-stream";

pub struct Asset {
    bytes: Vec<u8>,
    content_type: String,
}

impl Asset {
    #[must_use]
    pub fn create(bytes: Vec<u8>, content_type: String) -> Self {
        Self {
            bytes,
            content_type,
        }
    }

    #[must_use]
    pub fn into_parts(self) -> (Vec<u8>, String) {
        (self.bytes, self.content_type)
    }
}

pub trait Assets: Send + Sync {
    fn get(&self, path: &str) -> Option<Asset>;
}

#[derive(Clone)]
pub enum Bundle {
    Directory(PathBuf),
    Assets(Arc<dyn Assets>),
}

impl Bundle {
    pub(crate) async fn send(&self, pathname: &str) -> Option<Response<Body>> {
        let relative = read_relative(pathname)?;
        let mut response = match self {
            Self::Directory(root) => {
                let path = root.join(relative);
                send_file(&path, read_content_type(&path)).await?
            }
            Self::Assets(assets) => send_asset(assets.get(relative)?),
        };
        let cache_control = if relative.starts_with(HASHED_ASSETS) {
            IMMUTABLE
        } else {
            NO_STORE
        };
        response
            .headers_mut()
            .insert(CACHE_CONTROL, HeaderValue::from_static(cache_control));
        Some(response)
    }
}

#[must_use]
pub fn read_relative(pathname: &str) -> Option<&str> {
    let relative = pathname.trim_start_matches('/');
    if relative.is_empty() || relative.contains('%') {
        return None;
    }
    let named = Path::new(relative)
        .components()
        .all(|part| matches!(part, Component::Normal(_)));
    named.then_some(relative)
}

fn send_asset(asset: Asset) -> Response<Body> {
    let Asset {
        bytes,
        content_type,
    } = asset;
    let length = bytes.len();
    let mut response = Response::new(Body::from(bytes));
    let headers = response.headers_mut();
    let value =
        HeaderValue::from_str(&content_type).unwrap_or(HeaderValue::from_static(OCTET_STREAM));
    headers.insert(CONTENT_TYPE, value);
    headers.insert(CONTENT_LENGTH, HeaderValue::from(length));
    headers.insert(CACHE_CONTROL, HeaderValue::from_static(NO_STORE));
    response
}

pub(crate) fn read_content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some("js") => "text/javascript",
        Some("wasm") => "application/wasm",
        _ => OCTET_STREAM,
    }
}

pub(crate) fn resolve_asset(bundle_path: &Path, pathname: &str) -> Option<PathBuf> {
    Some(bundle_path.join(read_relative(pathname)?))
}

pub(crate) async fn send_file_range(
    path: &Path,
    content_type: &'static str,
    request: &HeaderMap,
) -> Option<Response<Body>> {
    let stat = metadata(path).await.ok()?;
    if !stat.is_file() {
        return None;
    }
    let size = stat.len();
    let range = match parse(request, size) {
        ByteRange::Full => return send_file(path, content_type).await,
        ByteRange::Unsatisfiable => {
            let mut response = Response::new(Body::empty());
            *response.status_mut() = StatusCode::RANGE_NOT_SATISFIABLE;
            let unsatisfied = HeaderValue::from_str(&format!("bytes */{size}")).ok()?;
            response.headers_mut().insert(CONTENT_RANGE, unsatisfied);
            return Some(response);
        }
        ByteRange::Partial(range) => range,
    };
    let mut content = File::open(path).await.ok()?;
    content.seek(SeekFrom::Start(range.start)).await.ok()?;
    let length = range.end - range.start + 1;
    let mut response = Response::new(Body::from_stream(ReaderStream::new(content.take(length))));
    *response.status_mut() = StatusCode::PARTIAL_CONTENT;
    let headers = response.headers_mut();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static(content_type));
    headers.insert(CONTENT_LENGTH, HeaderValue::from(length));
    let served = format!("bytes {}-{}/{size}", range.start, range.end);
    headers.insert(CONTENT_RANGE, HeaderValue::from_str(&served).ok()?);
    headers.insert(CACHE_CONTROL, HeaderValue::from_static(NO_STORE));
    Some(response)
}

pub(crate) async fn send_file(path: &Path, content_type: &'static str) -> Option<Response<Body>> {
    let stat = metadata(path).await.ok()?;
    if !stat.is_file() {
        return None;
    }
    let content = File::open(path).await.ok()?;
    let mut response = Response::new(Body::from_stream(ReaderStream::new(content)));
    let headers = response.headers_mut();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static(content_type));
    headers.insert(CONTENT_LENGTH, HeaderValue::from(stat.len()));
    headers.insert(CACHE_CONTROL, HeaderValue::from_static(NO_STORE));
    Some(response)
}
