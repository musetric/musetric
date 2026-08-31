use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Path as RequestPath, Query, State};
use axum::http::{header, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get, post};
use axum::{Json, Router};
use serde::Serialize;
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tokio_stream::StreamExt;
use tokio_util::io::ReaderStream;

use crate::download::{parse_request, run_download};
use crate::storage::{create_storage_paths, resolve_storage_path, StoragePaths};

pub(crate) struct ServerState {
    pub(crate) paths: StoragePaths,
    pub(crate) token: String,
    pub(crate) origin: String,
}

impl ServerState {
    pub(crate) fn authorize(&self, token: &str) -> bool {
        token == self.token
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub origin: String,
    pub token: String,
    pub root_path: String,
    pub blobs_path: String,
    pub models_path: String,
    pub database_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryEntry {
    name: String,
    size: u64,
    directory: bool,
}

pub(crate) fn failure(status: StatusCode, message: String) -> Response {
    (status, message).into_response()
}

pub(crate) fn content_type(path: &PathBuf) -> &'static str {
    match path.extension().and_then(|value| value.to_str()) {
        Some("aac") => "audio/aac",
        Some("flac") => "audio/flac",
        Some("m4a") | Some("mp4") => "audio/mp4",
        Some("mp3") => "audio/mpeg",
        Some("ogg") | Some("opus") => "audio/ogg",
        Some("wav") => "audio/wav",
        Some("webm") => "audio/webm",
        _ => "application/octet-stream",
    }
}

fn locate(state: &ServerState, token: &str, path: &str) -> Result<PathBuf, Response> {
    if !state.authorize(token) {
        return Err(failure(StatusCode::FORBIDDEN, "invalid token".to_owned()));
    }
    resolve_storage_path(&state.paths.root, path)
        .ok_or_else(|| failure(StatusCode::BAD_REQUEST, "invalid path".to_owned()))
}

async fn get_file(
    State(state): State<Arc<ServerState>>,
    RequestPath((token, path)): RequestPath<(String, String)>,
) -> Response {
    let target = match locate(&state, &token, &path) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let Ok(metadata) = fs::metadata(&target).await else {
        return failure(StatusCode::NOT_FOUND, "not found".to_owned());
    };
    let Ok(file) = fs::File::open(&target).await else {
        return failure(StatusCode::NOT_FOUND, "not found".to_owned());
    };
    let stream = ReaderStream::with_capacity(file, 1 << 18);
    Response::builder()
        .header(header::CONTENT_TYPE, content_type(&target))
        .header(header::CONTENT_LENGTH, metadata.len())
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from_stream(stream))
        .unwrap_or_else(|error| failure(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

async fn head_file(
    State(state): State<Arc<ServerState>>,
    RequestPath((token, path)): RequestPath<(String, String)>,
) -> Response {
    let target = match locate(&state, &token, &path) {
        Ok(value) => value,
        Err(response) => return response,
    };
    match fs::metadata(&target).await {
        Ok(metadata) => Response::builder()
            .header(header::CONTENT_TYPE, content_type(&target))
            .header(header::CONTENT_LENGTH, metadata.len())
            .body(Body::empty())
            .unwrap_or_else(|error| failure(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())),
        Err(_) => failure(StatusCode::NOT_FOUND, "not found".to_owned()),
    }
}

async fn put_file(
    State(state): State<Arc<ServerState>>,
    RequestPath((token, path)): RequestPath<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
    body: axum::body::Bytes,
) -> Response {
    let target = match locate(&state, &token, &path) {
        Ok(value) => value,
        Err(response) => return response,
    };
    if let Some(parent) = target.parent() {
        if let Err(error) = fs::create_dir_all(parent).await {
            return failure(StatusCode::INTERNAL_SERVER_ERROR, error.to_string());
        }
    }
    let append = query.get("append").map(String::as_str) == Some("1");
    let written = if append {
        append_file(&target, &body).await
    } else {
        replace_file(&target, &body).await
    };
    match written {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => failure(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
    }
}

async fn replace_file(target: &PathBuf, body: &[u8]) -> std::io::Result<()> {
    let mut pending = target.as_os_str().to_os_string();
    pending.push(format!(".{:08x}.writing", rand::random::<u32>()));
    let pending = PathBuf::from(pending);
    fs::write(&pending, body).await?;
    fs::rename(&pending, target).await
}

async fn append_file(target: &PathBuf, body: &[u8]) -> std::io::Result<()> {
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(target)
        .await?;
    file.write_all(body).await?;
    file.flush().await
}

async fn delete_file(
    State(state): State<Arc<ServerState>>,
    RequestPath((token, path)): RequestPath<(String, String)>,
) -> Response {
    let target = match locate(&state, &token, &path) {
        Ok(value) => value,
        Err(response) => return response,
    };
    if target.is_dir() {
        let _ = fs::remove_dir_all(&target).await;
    } else {
        let _ = fs::remove_file(&target).await;
    }
    StatusCode::NO_CONTENT.into_response()
}

async fn list_directory(
    State(state): State<Arc<ServerState>>,
    RequestPath((token, path)): RequestPath<(String, String)>,
) -> Response {
    let target = match locate(&state, &token, &path) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let Ok(mut entries) = fs::read_dir(&target).await else {
        return Json(Vec::<DirectoryEntry>::new()).into_response();
    };
    let mut result = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        let Ok(metadata) = entry.metadata().await else {
            continue;
        };
        result.push(DirectoryEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            size: metadata.len(),
            directory: metadata.is_dir(),
        });
    }
    Json(result).into_response()
}

async fn post_download(
    State(state): State<Arc<ServerState>>,
    RequestPath(token): RequestPath<String>,
    body: String,
) -> Response {
    let Some((request, path)) = parse_request(&body) else {
        return failure(
            StatusCode::BAD_REQUEST,
            "invalid download request".to_owned(),
        );
    };
    let target = match locate(&state, &token, &path) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let (sender, receiver) = mpsc::channel(16);
    tokio::spawn(run_download(request, target, sender));
    let stream =
        ReceiverStream::new(receiver).map(|line| Ok::<String, std::io::Error>(line + "\n"));
    Response::builder()
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from_stream(stream))
        .unwrap_or_else(|error| failure(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

async fn allow_cross_origin(
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    let preflight = request.method() == Method::OPTIONS;
    let mut response = if preflight {
        StatusCode::NO_CONTENT.into_response()
    } else {
        next.run(request).await
    };
    let headers = response.headers_mut();
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, HEAD, PUT, POST, DELETE, OPTIONS"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("*"),
    );
    headers.insert(
        header::HeaderName::from_static("access-control-allow-private-network"),
        HeaderValue::from_static("true"),
    );
    response
}

fn create_token() -> String {
    let mut token = String::new();
    for _ in 0..4 {
        token.push_str(&format!("{:08x}", rand::random::<u32>()));
    }
    token
}

/// Binds the storage server on the loopback interface. The webview reaches it
/// over a real socket, which is what keeps large files out of the Java heap the
/// Tauri asset protocol goes through.
pub async fn start_server(data_root: PathBuf) -> std::io::Result<StorageInfo> {
    let paths = create_storage_paths(&data_root);
    fs::create_dir_all(&paths.blobs).await?;
    fs::create_dir_all(&paths.models).await?;
    if let Some(parent) = paths.database.parent() {
        fs::create_dir_all(parent).await?;
    }
    let token = create_token();
    let root_path = paths.root.to_string_lossy().into_owned();
    let blobs_path = paths.blobs.to_string_lossy().into_owned();
    let models_path = paths.models.to_string_lossy().into_owned();
    let database_path = paths.database.to_string_lossy().into_owned();
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let origin = format!("http://127.0.0.1:{}", port);
    let state = Arc::new(ServerState {
        paths,
        token: token.clone(),
        origin: origin.clone(),
    });

    let router = Router::new()
        .merge(crate::project_api::router())
        .route(
            "/{token}/file/{*path}",
            get(get_file)
                .head(head_file)
                .put(put_file)
                .delete(delete_file),
        )
        .route("/{token}/list/{*path}", get(list_directory))
        .route("/{token}/download", post(post_download))
        .route("/{token}/health", get(health))
        .fallback(any(not_found))
        .layer(axum::middleware::from_fn(allow_cross_origin))
        .layer(DefaultBodyLimit::disable())
        .with_state(state);

    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    Ok(StorageInfo {
        origin,
        token,
        root_path,
        blobs_path,
        models_path,
        database_path,
    })
}

async fn health() -> &'static str {
    "ok"
}

async fn not_found() -> StatusCode {
    StatusCode::NOT_FOUND
}
