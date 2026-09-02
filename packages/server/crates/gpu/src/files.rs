use std::path::{Component, Path, PathBuf};

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

pub(crate) fn read_content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some("js") => "text/javascript",
        Some("wasm") => "application/wasm",
        _ => OCTET_STREAM,
    }
}

pub(crate) fn resolve_asset(bundle_path: &Path, pathname: &str) -> Option<PathBuf> {
    let relative = PathBuf::from(pathname.trim_start_matches('/'));
    let safe = relative
        .components()
        .all(|part| matches!(part, Component::Normal(_)));
    if !safe || relative.as_os_str().is_empty() {
        return None;
    }
    Some(bundle_path.join(relative))
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
