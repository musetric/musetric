use std::{
    path::{Component, Path, PathBuf},
    sync::Arc,
};

use axum::{
    Router,
    body::Body,
    extract::{Request, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, Uri},
    response::Response,
    routing::any,
};
use tokio::fs::{File, metadata};
use tokio_util::io::ReaderStream;

use crate::cached_file::{CachedFile, CachedHeaders, REVALIDATE_CACHE};

const INDEX: &str = "index.html";
const SERVER_PREFIXES: [&str; 1] = ["/api"];

#[derive(Clone)]
pub struct Frontend {
    source: FrontendSource,
}

#[derive(Clone)]
enum FrontendSource {
    Directory(PathBuf),
    Assets(Arc<dyn FrontendAssets>),
}

pub trait FrontendAssets: Send + Sync {
    fn get(&self, path: &str) -> Option<FrontendAsset>;
}

pub struct FrontendAsset {
    bytes: Vec<u8>,
    content_type: String,
}

impl FrontendAsset {
    #[must_use]
    pub fn new(bytes: Vec<u8>, content_type: String) -> Self {
        Self {
            bytes,
            content_type,
        }
    }
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
    pub fn from_assets(assets: Arc<dyn FrontendAssets>) -> Self {
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
                let path = resolve(public_path, pathname)?;
                send_file(&path, visit).await
            }
            FrontendSource::Assets(assets) => assets
                .get(normalize(pathname))
                .map(|asset| send_asset(asset, visit)),
        }
    }
}

fn resolve(public_path: &Path, pathname: &str) -> Option<PathBuf> {
    let relative = PathBuf::from(pathname.trim_start_matches('/'));
    let safe = relative
        .components()
        .all(|part| matches!(part, Component::Normal(_)));
    if !safe {
        return None;
    }
    if relative.as_os_str().is_empty() {
        return Some(public_path.join(INDEX));
    }
    Some(public_path.join(relative))
}

fn normalize(pathname: &str) -> &str {
    pathname.trim_start_matches('/')
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

fn send_asset(asset: FrontendAsset, visit: &Visit<'_>) -> Response<Body> {
    let FrontendAsset {
        bytes,
        content_type,
    } = asset;
    let mut response = if visit.method == Method::HEAD {
        Response::new(Body::empty())
    } else {
        Response::new(Body::from(bytes))
    };
    response.headers_mut().insert(
        "content-type",
        HeaderValue::from_str(&content_type)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
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

#[cfg(test)]
mod tests {
    use std::{
        fs::{create_dir_all, remove_dir_all, write},
        path::PathBuf,
        process::id,
        sync::atomic::{AtomicUsize, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    use axum::{
        body::{Body, to_bytes},
        http::{
            HeaderMap, HeaderValue, Method, StatusCode, Uri,
            header::{CACHE_CONTROL, CONTENT_TYPE, ETAG, IF_NONE_MATCH},
        },
        response::Response,
    };

    use super::{Frontend, Visit};

    static PUBLIC_COUNT: AtomicUsize = AtomicUsize::new(0);

    const INDEX_HTML: &str = "<!doctype html><title>Musetric</title>";
    const SCRIPT: &str = "export const start = () => undefined;\n";

    struct Public {
        directory: PathBuf,
    }

    impl Public {
        fn new() -> Self {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("the clock should be after the epoch")
                .as_nanos();
            let ordinal = PUBLIC_COUNT.fetch_add(1, Ordering::Relaxed);
            let directory =
                std::env::temp_dir().join(format!("musetric-public-{}-{stamp}-{ordinal}", id()));
            create_dir_all(directory.join("assets")).expect("the public directory should be built");
            write(directory.join("index.html"), INDEX_HTML).expect("the index should be written");
            write(directory.join("assets").join("index.js"), SCRIPT)
                .expect("the script should be written");
            Self { directory }
        }
    }

    impl Drop for Public {
        fn drop(&mut self) {
            let _ = remove_dir_all(&self.directory);
        }
    }

    async fn visit(frontend: &Frontend, pathname: &str) -> Option<Response<Body>> {
        visit_with(frontend, pathname, &HeaderMap::new()).await
    }

    async fn visit_with(
        frontend: &Frontend,
        pathname: &str,
        headers: &HeaderMap,
    ) -> Option<Response<Body>> {
        let uri = pathname.parse::<Uri>().expect("the path should be a uri");
        frontend
            .respond(Visit {
                method: &Method::GET,
                uri: &uri,
                headers,
            })
            .await
    }

    async fn read(response: Response<Body>) -> (StatusCode, String, String) {
        let status = response.status();
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_owned();
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("the body should be read");
        (status, content_type, String::from_utf8_lossy(&body).into())
    }

    #[tokio::test]
    async fn answers_a_deep_link_with_the_app_shell() {
        let public = Public::new();
        let frontend = Frontend::from_directory(public.directory.clone());

        let root = visit(&frontend, "/").await.expect("the root should answer");
        let deep = visit(&frontend, "/project/1/lyrics")
            .await
            .expect("a deep link should answer");

        let (root_status, root_type, root_body) = read(root).await;
        assert_eq!(root_status, StatusCode::OK);
        assert_eq!(root_type, "text/html; charset=utf-8");
        assert_eq!(root_body, INDEX_HTML);
        let (deep_status, _, deep_body) = read(deep).await;
        assert_eq!(deep_status, StatusCode::OK);
        assert_eq!(deep_body, INDEX_HTML);
    }

    #[tokio::test]
    async fn answers_an_asset_with_its_own_content_type() {
        let public = Public::new();
        let frontend = Frontend::from_directory(public.directory.clone());

        let asset = visit(&frontend, "/assets/index.js")
            .await
            .expect("the asset should answer");

        let (status, content_type, body) = read(asset).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(content_type, "text/javascript; charset=utf-8");
        assert_eq!(body, SCRIPT);
    }

    #[tokio::test]
    async fn leaves_the_server_paths_and_the_missing_files_alone() {
        let public = Public::new();
        let frontend = Frontend::from_directory(public.directory.clone());

        assert!(visit(&frontend, "/api/project/list").await.is_none());
        assert!(visit(&frontend, "/assets/missing.js").await.is_none());
        assert!(visit(&frontend, "/../secret").await.is_none());
    }

    #[tokio::test]
    async fn answers_not_modified_for_a_known_asset() {
        let public = Public::new();
        let frontend = Frontend::from_directory(public.directory.clone());
        let first = visit(&frontend, "/assets/index.js")
            .await
            .expect("the asset should answer");
        let etag = first
            .headers()
            .get(ETAG)
            .and_then(|value| value.to_str().ok())
            .expect("the asset should carry an etag")
            .to_owned();
        let cache_control = first
            .headers()
            .get(CACHE_CONTROL)
            .and_then(|value| value.to_str().ok())
            .expect("the asset should carry a cache policy")
            .to_owned();
        let mut headers = HeaderMap::new();
        headers.insert(
            IF_NONE_MATCH,
            HeaderValue::from_str(&etag).expect("the etag should be a header"),
        );

        let repeated = visit_with(&frontend, "/assets/index.js", &headers)
            .await
            .expect("the asset should answer again");

        assert_eq!(cache_control, "public, max-age=0");
        assert_eq!(repeated.status(), StatusCode::NOT_MODIFIED);
    }
}
