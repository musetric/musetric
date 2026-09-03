use std::{
    path::{Component, Path, PathBuf},
    sync::Arc,
};

use axum::{
    body::Body,
    http::{
        HeaderValue,
        header::{CACHE_CONTROL, CONTENT_LENGTH, CONTENT_TYPE},
    },
    response::Response,
};
use tokio::fs::{File, metadata};
use tokio_util::io::ReaderStream;

pub(crate) const LOADER_HTML: &str = concat!(
    "<!doctype html><html><head><meta charset=\"utf-8\"></head><body>",
    "<script type=\"module\" src=\"/index.js\"></script>",
    "</body></html>"
);
pub(crate) const NO_STORE: &str = "no-store";
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
        match self {
            Self::Directory(root) => {
                let path = resolve_asset(root, pathname)?;
                let content_type = read_content_type(&path);
                send_file(&path, content_type).await
            }
            Self::Assets(assets) => assets.get(read_relative(pathname)?).map(send_asset),
        }
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
