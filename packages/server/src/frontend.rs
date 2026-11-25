use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use axum::{
    Router,
    body::Body,
    extract::{Request, State},
    http::{
        HeaderMap, HeaderValue, Method, StatusCode, Uri,
        header::{CONTENT_LENGTH, CONTENT_TYPE},
    },
    response::Response,
    routing::any,
};
use musetric_gpu::{Asset, Assets, read_relative};
use tokio::fs::{File, metadata};
use tokio_util::io::ReaderStream;

use crate::cached_file::{CachedFile, CachedHeaders, REVALIDATE_CACHE};

const INDEX: &str = "index.html";
const OCTET_STREAM: &str = "application/octet-stream";
const SERVER_PREFIXES: [&str; 1] = ["/api"];

#[derive(Clone)]
pub struct Frontend {
    source: FrontendSource,
}

#[derive(Clone)]
enum FrontendSource {
    Directory(PathBuf),
    Assets(Arc<dyn Assets>),
}

struct Visit<'visit> {
    method: &'visit Method,
    uri: &'visit Uri,
    headers: &'visit HeaderMap,
}

pub(crate) fn create_router(frontend: Frontend) -> Router {
    Router::new().fallback(any(handle)).with_state(frontend)
}

async fn handle(State(frontend): State<Frontend>, request: Request) -> Response<Body> {
    let visit = Visit {
        method: request.method(),
        uri: request.uri(),
        headers: request.headers(),
    };
    match frontend.respond(visit).await {
        Some(response) => response,
        None => missing(),
    }
}

impl Frontend {
    #[must_use]
    pub fn from_directory(public_path: PathBuf) -> Self {
        Self {
            source: FrontendSource::Directory(public_path),
        }
    }

    #[must_use]
    pub fn from_assets(assets: Arc<dyn Assets>) -> Self {
        Self {
            source: FrontendSource::Assets(assets),
        }
    }

    async fn respond(&self, visit: Visit<'_>) -> Option<Response<Body>> {
        if visit.method != Method::GET && visit.method != Method::HEAD {
            return None;
        }
        let pathname = visit.uri.path();
        if let Some(response) = self.send(pathname, &visit).await {
            return Some(response);
        }
        if !serves_the_app(pathname) {
            return None;
        }
        Some(self.send(INDEX, &visit).await.unwrap_or_else(missing))
    }

    async fn send(&self, pathname: &str, visit: &Visit<'_>) -> Option<Response<Body>> {
        match &self.source {
            FrontendSource::Directory(public_path) => {
                let path = public_path.join(read_relative(pathname)?);
                send_file(&path, visit).await
            }
            FrontendSource::Assets(assets) => assets
                .get(read_relative(pathname)?)
                .map(|asset| send_asset(asset, visit)),
        }
    }
}

fn serves_the_app(pathname: &str) -> bool {
    let served = SERVER_PREFIXES
        .iter()
        .any(|prefix| pathname.starts_with(prefix));
    !served && !pathname.contains('.')
}

async fn send_file(path: &Path, visit: &Visit<'_>) -> Option<Response<Body>> {
    let stat = metadata(path).await.ok()?;
    if !stat.is_file() {
        return None;
    }
    let file = CachedFile {
        filename: None,
        content_type: read_content_type(path).to_owned(),
        cache_control: REVALIDATE_CACHE,
        size: stat.len(),
        modified: stat.modified().ok()?,
    };
    let headers = CachedHeaders::create(&file).ok()?;
    if headers.is_not_modified(visit.headers) {
        return Some(headers.respond_not_modified());
    }
    if visit.method == Method::HEAD {
        return Some(headers.respond(stat.len(), Body::empty()));
    }
    let opened = File::open(path).await.ok()?;
    Some(headers.respond(stat.len(), Body::from_stream(ReaderStream::new(opened))))
}

fn send_asset(asset: Asset, visit: &Visit<'_>) -> Response<Body> {
    let (bytes, content_type) = asset.into_parts();
    let length = bytes.len();
    let mut response = if visit.method == Method::HEAD {
        Response::new(Body::empty())
    } else {
        Response::new(Body::from(bytes))
    };
    let headers = response.headers_mut();
    headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_str(&content_type)
            .unwrap_or_else(|_| HeaderValue::from_static(OCTET_STREAM)),
    );
    if let Ok(value) = HeaderValue::from_str(&length.to_string()) {
        headers.insert(CONTENT_LENGTH, value);
    }
    response
}

fn missing() -> Response<Body> {
    let mut response = Response::new(Body::from("not found"));
    *response.status_mut() = StatusCode::NOT_FOUND;
    response
}

fn read_content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("webmanifest") => "application/manifest+json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("ico") => "image/x-icon",
        Some("wasm") => "application/wasm",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    }
}
