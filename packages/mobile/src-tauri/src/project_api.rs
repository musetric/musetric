use std::convert::Infallible;
use std::path::PathBuf;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Multipart, Path as RequestPath, State};
use axum::http::{header, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, patch, post};
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::fs;
use tokio::io::{AsyncSeekExt, AsyncWriteExt};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tokio_util::io::ReaderStream;

use crate::server::{content_type, failure, ServerState};
use crate::storage::resolve_storage_path;

const PROJECT_STEPS: [&str; 5] = ["separation", "transcription", "rhythm", "key", "chords"];
const WAV_HEADER_BYTE_LENGTH: u64 = 44;
const MAX_RECORDING_FRAME_COUNT: u64 = 100_000_000;
const WAVE_PEAK_COUNT: usize = 3_840;

type ApiState = Arc<ServerState>;

pub fn router() -> Router<ApiState> {
    Router::new()
        .route("/{token}/api/project/list", get(list_projects))
        .route("/{token}/api/project/create", post(create_project))
        .route(
            "/{token}/api/project/status/stream",
            get(project_status_stream),
        )
        .route("/{token}/api/project/{project_id}", get(get_project))
        .route(
            "/{token}/api/project/{project_id}/retry",
            post(retry_project),
        )
        .route(
            "/{token}/api/project/{project_id}/edit",
            patch(edit_project),
        )
        .route(
            "/{token}/api/project/{project_id}/remove",
            delete(remove_project),
        )
        .route(
            "/{token}/api/project/{project_id}/realtime",
            get(project_realtime),
        )
        .route("/{token}/api/chords/project/{project_id}", get(get_chords))
        .route("/{token}/api/key/project/{project_id}", get(get_key))
        .route("/{token}/api/rhythm/project/{project_id}", get(get_rhythm))
        .route(
            "/{token}/api/subtitle/project/{project_id}",
            get(get_subtitle),
        )
        .route("/{token}/api/preview/{project_id}", get(get_preview))
        .route(
            "/{token}/api/audio/project/{project_id}/master/{audio_type}/content",
            get(get_master_content),
        )
        .route(
            "/{token}/api/audio/project/{project_id}/delivery/{stem_type}/content",
            get(get_delivery_content),
        )
        .route(
            "/{token}/api/audio/project/{project_id}/delivery/{stem_type}/wave",
            get(get_delivery_wave),
        )
        .route(
            "/{token}/api/audio/project/{project_id}/recording/content",
            get(get_recording_content),
        )
        .route(
            "/{token}/api/audio/project/{project_id}/recording/wave",
            get(get_recording_wave),
        )
}

fn parse_project_id(value: &str) -> Result<i64, Response> {
    value
        .parse::<i64>()
        .map_err(|_| failure(StatusCode::BAD_REQUEST, "invalid project id".to_owned()))
}

fn project_number(project: &Value) -> i64 {
    if let Some(value) = project.get("desktopId").and_then(Value::as_i64) {
        return value.max(1);
    }
    let project_id = project
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let mut hash: u32 = 2_166_136_261;
    for byte in project_id.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(16_777_619);
    }
    i64::from(hash.max(1))
}

fn project_path(project: &Value) -> Option<&str> {
    project.get("id").and_then(Value::as_str)
}

fn project_metadata_path(state: &ServerState, project: &Value) -> Option<PathBuf> {
    project_path(project).map(|project_id| {
        state
            .paths
            .root
            .join("projects")
            .join(project_id)
            .join("project.json")
    })
}

async fn save_project_metadata(state: &ServerState, project: &Value) -> Result<(), Response> {
    let Some(metadata_path) = project_metadata_path(state, project) else {
        return Err(failure(
            StatusCode::INTERNAL_SERVER_ERROR,
            "invalid project metadata".to_owned(),
        ));
    };
    let encoded = serde_json::to_vec(project)
        .map_err(|error| failure(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    if let Some(parent) = metadata_path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|error| failure(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    }
    fs::write(metadata_path, encoded)
        .await
        .map_err(|error| failure(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

fn value_string(project: &Value, key: &str) -> String {
    project
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

fn default_processing(status: &str) -> Value {
    let mut steps = serde_json::Map::new();
    for step in PROJECT_STEPS {
        steps.insert(step.to_owned(), json!({ "status": status }));
    }
    json!({ "done": status == "done", "steps": steps })
}

fn processing(project: &Value) -> Value {
    if let Some(value) = project.get("processing").filter(|value| value.is_object()) {
        let mut result = value.clone();
        let complete = project.get("analysis").is_some()
            && project
                .get("stems")
                .and_then(Value::as_array)
                .map(|stems| stems.len() == 3)
                .unwrap_or(false)
            && project.get("transcript").is_some();
        if let Some(object) = result.as_object_mut() {
            object.insert("done".to_owned(), Value::Bool(complete));
        }
        return result;
    }
    let complete = project.get("analysis").is_some()
        && project
            .get("stems")
            .and_then(Value::as_array)
            .map(|stems| stems.len() == 3)
            .unwrap_or(false)
        && project.get("transcript").is_some();
    default_processing(if complete { "done" } else { "pending" })
}

fn stem_frame_count(project: &Value) -> Option<u64> {
    project
        .get("stems")
        .and_then(Value::as_array)
        .and_then(|stems| stems.first())
        .and_then(|stem| stem.get("size"))
        .and_then(Value::as_u64)
        .and_then(|size| size.checked_sub(WAV_HEADER_BYTE_LENGTH))
        .map(|size| size / 4)
}

fn item(state: &ServerState, token: &str, project: &Value) -> Value {
    let preview_url = project
        .get("preview")
        .filter(|preview| preview.is_object())
        .map(|_| {
            format!(
                "{}/{}/api/preview/{}",
                state.origin,
                token,
                project_number(project)
            )
        });
    let source_size = project
        .get("sourceSize")
        .and_then(Value::as_u64)
        .unwrap_or(4);
    let frame_count = stem_frame_count(project)
        .or_else(|| project.get("frameCount").and_then(Value::as_u64))
        .unwrap_or((source_size / 4).max(1));
    let mut result = json!({
        "id": project_number(project),
        "name": value_string(project, "name"),
        "sampleRate": project.get("sampleRate").and_then(Value::as_u64).unwrap_or(44_100),
        "frameCount": frame_count,
        "processing": processing(project),
    });
    if let Some(preview_url) = preview_url {
        result["previewUrl"] = Value::String(preview_url);
    }
    if let Some(audio_analysis) = project
        .get("audioAnalysis")
        .filter(|value| value.is_object())
    {
        result["audioAnalysis"] = audio_analysis.clone();
    }
    result
}

async fn list_metadata(state: &ServerState) -> Vec<Value> {
    let directory = state.paths.root.join("projects");
    let Ok(mut entries) = fs::read_dir(directory).await else {
        return Vec::new();
    };
    let mut projects = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        let Ok(metadata) = entry.metadata().await else {
            continue;
        };
        if !metadata.is_dir() {
            continue;
        }
        let path = entry.path().join("project.json");
        let Ok(content) = fs::read(path).await else {
            continue;
        };
        let Ok(project) = serde_json::from_slice::<Value>(&content) else {
            continue;
        };
        if project_path(&project).is_some() {
            projects.push(project);
        }
    }
    projects.sort_by(|left, right| {
        value_string(right, "updatedAt").cmp(&value_string(left, "updatedAt"))
    });
    projects
}

async fn find_project(state: &ServerState, project_id: i64) -> Option<Value> {
    list_metadata(state)
        .await
        .into_iter()
        .find(|project| project_number(project) == project_id)
}

async fn verify_token(state: &ServerState, token: &str) -> Result<(), Response> {
    if state.authorize(token) {
        Ok(())
    } else {
        Err(failure(StatusCode::FORBIDDEN, "invalid token".to_owned()))
    }
}

async fn get_required_project(
    state: &ServerState,
    token: &str,
    project_id: &str,
) -> Result<Value, Response> {
    verify_token(state, token).await?;
    let project_id = parse_project_id(project_id)?;
    find_project(state, project_id)
        .await
        .ok_or_else(|| failure(StatusCode::NOT_FOUND, "project not found".to_owned()))
}

async fn list_projects(
    State(state): State<ApiState>,
    RequestPath(token): RequestPath<String>,
) -> Response {
    if let Err(response) = verify_token(&state, &token).await {
        return response;
    }
    let projects = list_metadata(&state).await;
    Json(
        projects
            .iter()
            .map(|project| item(&state, &token, project))
            .collect::<Vec<_>>(),
    )
    .into_response()
}

async fn get_project(
    State(state): State<ApiState>,
    RequestPath((token, project_id)): RequestPath<(String, String)>,
) -> Response {
    match get_required_project(&state, &token, &project_id).await {
        Ok(project) => Json(item(&state, &token, &project)).into_response(),
        Err(response) => response,
    }
}

async fn retry_project(
    State(state): State<ApiState>,
    RequestPath((token, project_id)): RequestPath<(String, String)>,
    Json(request): Json<Value>,
) -> Response {
    let Some(step) = request.get("step").and_then(Value::as_str) else {
        return failure(
            StatusCode::BAD_REQUEST,
            "processing step is required".to_owned(),
        );
    };
    if !PROJECT_STEPS.contains(&step) {
        return failure(
            StatusCode::BAD_REQUEST,
            "processing step is invalid".to_owned(),
        );
    }
    let mut project = match get_required_project(&state, &token, &project_id).await {
        Ok(project) => project,
        Err(response) => return response,
    };
    let retryable = {
        let Some(processing) = project.get_mut("processing").and_then(Value::as_object_mut) else {
            return failure(
                StatusCode::BAD_REQUEST,
                "project processing is invalid".to_owned(),
            );
        };
        let Some(steps) = processing.get_mut("steps").and_then(Value::as_object_mut) else {
            return failure(
                StatusCode::BAD_REQUEST,
                "project processing is invalid".to_owned(),
            );
        };
        let Some(processing_step) = steps.get_mut(step).and_then(Value::as_object_mut) else {
            return failure(
                StatusCode::BAD_REQUEST,
                "project processing is invalid".to_owned(),
            );
        };
        if processing_step.get("status").and_then(Value::as_str) != Some("failed") {
            false
        } else {
            processing_step.insert("status".to_owned(), Value::String("pending".to_owned()));
            processing_step.remove("progress");
            processing_step.remove("download");
            processing_step.remove("message");
            processing_step.remove("error");
            true
        }
    };
    if !retryable {
        return failure(
            StatusCode::BAD_REQUEST,
            "processing step is not failed".to_owned(),
        );
    }
    project["processing"]["done"] = Value::Bool(false);
    project["updatedAt"] = Value::String(chrono::Utc::now().to_rfc3339());
    if let Err(response) = save_project_metadata(&state, &project).await {
        return response;
    }
    Json(item(&state, &token, &project)).into_response()
}

fn create_project_id() -> String {
    let mut value = String::new();
    for _ in 0..4 {
        value.push_str(&format!("{:08x}", rand::random::<u32>()));
    }
    value
}

fn create_project_number() -> i64 {
    i64::from(rand::random::<u32>().max(1))
}

async fn save_field(
    mut field: axum::extract::multipart::Field<'_>,
    path: &PathBuf,
) -> Result<u64, Response> {
    let Some(parent) = path.parent() else {
        return Err(failure(
            StatusCode::INTERNAL_SERVER_ERROR,
            "invalid storage path".to_owned(),
        ));
    };
    fs::create_dir_all(parent)
        .await
        .map_err(|error| failure(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let mut file = fs::File::create(path)
        .await
        .map_err(|error| failure(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let mut size = 0_u64;
    while let Some(chunk) = field
        .chunk()
        .await
        .map_err(|error| failure(StatusCode::BAD_REQUEST, error.to_string()))?
    {
        file.write_all(&chunk)
            .await
            .map_err(|error| failure(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        size += chunk.len() as u64;
    }
    file.flush()
        .await
        .map_err(|error| failure(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(size)
}

async fn create_project(
    State(state): State<ApiState>,
    RequestPath(token): RequestPath<String>,
    mut multipart: Multipart,
) -> Response {
    if let Err(response) = verify_token(&state, &token).await {
        return response;
    }
    let id = create_project_id();
    let project_root = state.paths.root.join("projects").join(&id);
    let source_path = project_root.join("source");
    let preview_path = project_root.join("preview");
    let mut name = String::new();
    let mut source_filename = String::new();
    let mut source_content_type = "application/octet-stream".to_owned();
    let mut source_size = 0_u64;
    let mut preview: Option<Value> = None;
    loop {
        let field = match multipart.next_field().await {
            Ok(Some(field)) => field,
            Ok(None) => break,
            Err(error) => return failure(StatusCode::BAD_REQUEST, error.to_string()),
        };
        let field_name = field.name().unwrap_or_default().to_owned();
        if field_name == "name" {
            name = match field.text().await {
                Ok(value) => value,
                Err(error) => return failure(StatusCode::BAD_REQUEST, error.to_string()),
            };
            continue;
        }
        if field_name == "song" {
            source_filename = field.file_name().unwrap_or("audio").to_owned();
            source_content_type = field
                .content_type()
                .map(ToString::to_string)
                .unwrap_or_else(|| "application/octet-stream".to_owned());
            source_size = match save_field(field, &source_path).await {
                Ok(size) => size,
                Err(response) => return response,
            };
            continue;
        }
        if field_name == "preview" {
            let content_type = field
                .content_type()
                .map(ToString::to_string)
                .unwrap_or_else(|| "application/octet-stream".to_owned());
            let size = match save_field(field, &preview_path).await {
                Ok(size) => size,
                Err(response) => return response,
            };
            preview = Some(json!({
                "path": format!("projects/{}/preview", id),
                "contentType": content_type,
                "size": size,
            }));
        }
    }
    if source_size == 0 || name.trim().len() < 3 {
        let _ = fs::remove_dir_all(&project_root).await;
        return failure(
            StatusCode::BAD_REQUEST,
            "a name and audio file are required".to_owned(),
        );
    }
    let now = chrono::Utc::now().to_rfc3339();
    let project = json!({
        "id": id,
        "desktopId": create_project_number(),
        "name": name.trim(),
        "sourcePath": format!("projects/{}/source", id),
        "sourceFilename": source_filename,
        "sourceContentType": source_content_type,
        "sourceSize": source_size,
        "createdAt": now,
        "updatedAt": now,
        "cues": [],
        "recordings": [],
        "stems": [],
        "preview": preview,
        "processing": default_processing("pending"),
    });
    if let Err(response) = save_project_metadata(&state, &project).await {
        return response;
    }
    Json(item(&state, &token, &project)).into_response()
}

async fn edit_project(
    State(state): State<ApiState>,
    RequestPath((token, project_id)): RequestPath<(String, String)>,
    mut multipart: Multipart,
) -> Response {
    let mut project = match get_required_project(&state, &token, &project_id).await {
        Ok(project) => project,
        Err(response) => return response,
    };
    let mut name: Option<String> = None;
    let mut without_preview = false;
    let mut preview: Option<Value> = None;
    loop {
        let field = match multipart.next_field().await {
            Ok(Some(field)) => field,
            Ok(None) => break,
            Err(error) => return failure(StatusCode::BAD_REQUEST, error.to_string()),
        };
        if field.name() == Some("name") {
            name = match field.text().await {
                Ok(value) => Some(value),
                Err(error) => return failure(StatusCode::BAD_REQUEST, error.to_string()),
            };
            continue;
        }
        if field.name() == Some("withoutPreview") {
            without_preview = match field.text().await {
                Ok(value) => value == "true",
                Err(error) => return failure(StatusCode::BAD_REQUEST, error.to_string()),
            };
            continue;
        }
        if field.name() == Some("preview") {
            let Some(id) = project_path(&project) else {
                return failure(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "invalid project metadata".to_owned(),
                );
            };
            let path = state.paths.root.join("projects").join(id).join("preview");
            let content_type = field
                .content_type()
                .map(ToString::to_string)
                .unwrap_or_else(|| "application/octet-stream".to_owned());
            let size = match save_field(field, &path).await {
                Ok(size) => size,
                Err(response) => return response,
            };
            preview = Some(json!({
                "path": format!("projects/{}/preview", id),
                "contentType": content_type,
                "size": size,
            }));
        }
    }
    if let Some(name) = name {
        if name.trim().len() < 3 {
            return failure(
                StatusCode::BAD_REQUEST,
                "project name is too short".to_owned(),
            );
        }
        project["name"] = Value::String(name.trim().to_owned());
    }
    if without_preview {
        project
            .as_object_mut()
            .map(|object| object.remove("preview"));
        if let Some(id) = project_path(&project) {
            let _ =
                fs::remove_file(state.paths.root.join("projects").join(id).join("preview")).await;
        }
    }
    if let Some(preview) = preview {
        project["preview"] = preview;
    }
    project["updatedAt"] = Value::String(chrono::Utc::now().to_rfc3339());
    if let Err(response) = save_project_metadata(&state, &project).await {
        return response;
    }
    Json(item(&state, &token, &project)).into_response()
}

async fn remove_project(
    State(state): State<ApiState>,
    RequestPath((token, project_id)): RequestPath<(String, String)>,
) -> Response {
    let project = match get_required_project(&state, &token, &project_id).await {
        Ok(project) => project,
        Err(response) => return response,
    };
    let Some(id) = project_path(&project) else {
        return failure(
            StatusCode::INTERNAL_SERVER_ERROR,
            "invalid project metadata".to_owned(),
        );
    };
    let path = state.paths.root.join("projects").join(id);
    match fs::remove_dir_all(path).await {
        Ok(()) => StatusCode::OK.into_response(),
        Err(error) => failure(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
    }
}

async fn analysis_response(
    state: &ServerState,
    token: &str,
    project_id: &str,
    field: &str,
) -> Response {
    let project = match get_required_project(state, token, project_id).await {
        Ok(project) => project,
        Err(response) => return response,
    };
    let value = project
        .get("analysis")
        .and_then(|analysis| analysis.get(field))
        .cloned();
    match value {
        Some(value) => Json(value).into_response(),
        None => failure(StatusCode::NOT_FOUND, "analysis is not ready".to_owned()),
    }
}

async fn get_chords(
    State(state): State<ApiState>,
    RequestPath((token, project_id)): RequestPath<(String, String)>,
) -> Response {
    analysis_response(&state, &token, &project_id, "chords").await
}

async fn get_key(
    State(state): State<ApiState>,
    RequestPath((token, project_id)): RequestPath<(String, String)>,
) -> Response {
    analysis_response(&state, &token, &project_id, "key").await
}

async fn get_rhythm(
    State(state): State<ApiState>,
    RequestPath((token, project_id)): RequestPath<(String, String)>,
) -> Response {
    analysis_response(&state, &token, &project_id, "rhythm").await
}

async fn get_subtitle(
    State(state): State<ApiState>,
    RequestPath((token, project_id)): RequestPath<(String, String)>,
) -> Response {
    let project = match get_required_project(&state, &token, &project_id).await {
        Ok(project) => project,
        Err(response) => return response,
    };
    Json(
        project
            .get("transcript")
            .cloned()
            .unwrap_or_else(|| json!([])),
    )
    .into_response()
}

async fn resolve_project_file(
    state: &ServerState,
    token: &str,
    project_id: &str,
    path: Option<&str>,
) -> Result<(PathBuf, String), Response> {
    let project = get_required_project(state, token, project_id).await?;
    let path =
        path.ok_or_else(|| failure(StatusCode::NOT_FOUND, "audio is not ready".to_owned()))?;
    let target = resolve_storage_path(&state.paths.root, path)
        .ok_or_else(|| failure(StatusCode::BAD_REQUEST, "invalid storage path".to_owned()))?;
    let content_type = project
        .get("sourceContentType")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_else(|| content_type(&target).to_owned());
    Ok((target, content_type))
}

async fn serve_file(path: PathBuf, content_type: String) -> Response {
    let Ok(metadata) = fs::metadata(&path).await else {
        return failure(StatusCode::NOT_FOUND, "not found".to_owned());
    };
    let Ok(file) = fs::File::open(path).await else {
        return failure(StatusCode::NOT_FOUND, "not found".to_owned());
    };
    let stream = ReaderStream::with_capacity(file, 1 << 18);
    Response::builder()
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_LENGTH, metadata.len())
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from_stream(stream))
        .unwrap_or_else(|error| failure(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

fn find_stem_path<'a>(project: &'a Value, stem_type: &str) -> Option<&'a str> {
    project
        .get("stems")
        .and_then(Value::as_array)
        .and_then(|stems| {
            stems
                .iter()
                .find(|stem| stem.get("id").and_then(Value::as_str) == Some(stem_type))
        })
        .and_then(|stem| stem.get("path"))
        .and_then(Value::as_str)
}

fn latest_wav_recording_path(project: &Value) -> Option<&str> {
    project
        .get("recordings")
        .and_then(Value::as_array)
        .and_then(|recordings| recordings.last())
        .filter(|recording| {
            recording
                .get("contentType")
                .and_then(Value::as_str)
                .is_some_and(|content_type| content_type.starts_with("audio/wav"))
        })
        .and_then(|recording| recording.get("path"))
        .and_then(Value::as_str)
}

async fn get_master_content(
    State(state): State<ApiState>,
    RequestPath((token, project_id, audio_type)): RequestPath<(String, String, String)>,
) -> Response {
    let project = match get_required_project(&state, &token, &project_id).await {
        Ok(project) => project,
        Err(response) => return response,
    };
    let source = if audio_type == "source" {
        project.get("sourcePath").and_then(Value::as_str)
    } else {
        find_stem_path(&project, &audio_type)
    };
    match resolve_project_file(&state, &token, &project_id, source).await {
        Ok((path, content_type)) => serve_file(path, content_type).await,
        Err(response) => response,
    }
}

async fn get_delivery_content(
    State(state): State<ApiState>,
    RequestPath((token, project_id, stem_type)): RequestPath<(String, String, String)>,
) -> Response {
    let project = match get_required_project(&state, &token, &project_id).await {
        Ok(project) => project,
        Err(response) => return response,
    };
    let source = find_stem_path(&project, &stem_type);
    match resolve_project_file(&state, &token, &project_id, source).await {
        Ok((path, content_type)) => serve_file(path, content_type).await,
        Err(response) => response,
    }
}

fn empty_wav() -> Vec<u8> {
    let mut wav = Vec::with_capacity(44);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&36_u32.to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16_u32.to_le_bytes());
    wav.extend_from_slice(&1_u16.to_le_bytes());
    wav.extend_from_slice(&1_u16.to_le_bytes());
    wav.extend_from_slice(&44_100_u32.to_le_bytes());
    wav.extend_from_slice(&88_200_u32.to_le_bytes());
    wav.extend_from_slice(&2_u16.to_le_bytes());
    wav.extend_from_slice(&16_u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&0_u32.to_le_bytes());
    wav
}

async fn get_recording_content(
    State(state): State<ApiState>,
    RequestPath((token, project_id)): RequestPath<(String, String)>,
) -> Response {
    let project = match get_required_project(&state, &token, &project_id).await {
        Ok(project) => project,
        Err(response) => return response,
    };
    let source = latest_wav_recording_path(&project);
    if let Some(source) = source {
        match resolve_project_file(&state, &token, &project_id, Some(source)).await {
            Ok((path, content_type)) => return serve_file(path, content_type).await,
            Err(response) => return response,
        }
    }
    Response::builder()
        .header(header::CONTENT_TYPE, "audio/wav")
        .body(Body::from(empty_wav()))
        .unwrap_or_else(|error| failure(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

fn empty_wave() -> Vec<u8> {
    let mut bytes = Vec::with_capacity(WAVE_PEAK_COUNT * 2 * std::mem::size_of::<f32>());
    for _ in 0..WAVE_PEAK_COUNT * 2 {
        bytes.extend_from_slice(&0_f32.to_le_bytes());
    }
    bytes
}

async fn generate_wav_peaks(path: &PathBuf) -> Result<Vec<u8>, Response> {
    let bytes = fs::read(path)
        .await
        .map_err(|_| failure(StatusCode::NOT_FOUND, "audio is not ready".to_owned()))?;
    if bytes.len() < WAV_HEADER_BYTE_LENGTH as usize
        || &bytes[0..4] != b"RIFF"
        || &bytes[8..12] != b"WAVE"
    {
        return Err(failure(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "waveform source must be WAV".to_owned(),
        ));
    }
    let channel_count = u16::from_le_bytes([bytes[22], bytes[23]]) as usize;
    let bits_per_sample = u16::from_le_bytes([bytes[34], bytes[35]]);
    if channel_count == 0 || bits_per_sample != 16 {
        return Err(failure(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "waveform source must be 16-bit PCM".to_owned(),
        ));
    }
    let bytes_per_frame = channel_count * 2;
    let sample_data = &bytes[WAV_HEADER_BYTE_LENGTH as usize..];
    let frame_count = sample_data.len() / bytes_per_frame;
    if frame_count == 0 {
        return Ok(empty_wave());
    }
    let mut peaks = vec![(0_f32, 0_f32, false); WAVE_PEAK_COUNT];
    for frame_index in 0..frame_count {
        let start = frame_index * bytes_per_frame;
        let mut value = 0_f32;
        for channel_index in 0..channel_count {
            let offset = start + channel_index * 2;
            let sample = i16::from_le_bytes([sample_data[offset], sample_data[offset + 1]]);
            value += f32::from(sample) / 32_768_f32;
        }
        value /= channel_count as f32;
        let segment = (frame_index * WAVE_PEAK_COUNT / frame_count).min(WAVE_PEAK_COUNT - 1);
        let peak = &mut peaks[segment];
        if !peak.2 {
            *peak = (value, value, true);
        } else {
            peak.0 = peak.0.min(value);
            peak.1 = peak.1.max(value);
        }
    }
    let mut result = Vec::with_capacity(WAVE_PEAK_COUNT * 2 * std::mem::size_of::<f32>());
    for (min, max, _) in peaks {
        result.extend_from_slice(&min.to_le_bytes());
        result.extend_from_slice(&max.to_le_bytes());
    }
    Ok(result)
}

fn wave_response(peaks: Vec<u8>) -> Response {
    Response::builder()
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(Body::from(peaks))
        .unwrap_or_else(|error| failure(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

async fn get_delivery_wave(
    State(state): State<ApiState>,
    RequestPath((token, project_id, stem_type)): RequestPath<(String, String, String)>,
) -> Response {
    let project = match get_required_project(&state, &token, &project_id).await {
        Ok(project) => project,
        Err(response) => return response,
    };
    let Some(path) = find_stem_path(&project, &stem_type) else {
        return failure(StatusCode::NOT_FOUND, "audio is not ready".to_owned());
    };
    let Some(path) = resolve_storage_path(&state.paths.root, path) else {
        return failure(StatusCode::BAD_REQUEST, "invalid storage path".to_owned());
    };
    match generate_wav_peaks(&path).await {
        Ok(peaks) => wave_response(peaks),
        Err(response) => response,
    }
}

async fn get_recording_wave(
    State(state): State<ApiState>,
    RequestPath((token, project_id)): RequestPath<(String, String)>,
) -> Response {
    let project = match get_required_project(&state, &token, &project_id).await {
        Ok(project) => project,
        Err(response) => return response,
    };
    let path = latest_wav_recording_path(&project);
    let Some(path) = path else {
        return wave_response(empty_wave());
    };
    let Some(path) = resolve_storage_path(&state.paths.root, path) else {
        return failure(StatusCode::BAD_REQUEST, "invalid storage path".to_owned());
    };
    match generate_wav_peaks(&path).await {
        Ok(peaks) => wave_response(peaks),
        Err(response) => response,
    }
}

async fn get_preview(
    State(state): State<ApiState>,
    RequestPath((token, project_id)): RequestPath<(String, String)>,
) -> Response {
    let project = match get_required_project(&state, &token, &project_id).await {
        Ok(project) => project,
        Err(response) => return response,
    };
    let source = project
        .get("preview")
        .and_then(|preview| preview.get("path"))
        .and_then(Value::as_str);
    let content_type = project
        .get("preview")
        .and_then(|preview| preview.get("contentType"))
        .and_then(Value::as_str)
        .unwrap_or("application/octet-stream")
        .to_owned();
    let Some(source) = source else {
        return failure(StatusCode::NOT_FOUND, "preview not found".to_owned());
    };
    let target = match resolve_storage_path(&state.paths.root, source) {
        Some(path) => path,
        None => return failure(StatusCode::BAD_REQUEST, "invalid storage path".to_owned()),
    };
    serve_file(target, content_type).await
}

async fn project_status_stream(
    State(state): State<ApiState>,
    RequestPath(token): RequestPath<String>,
) -> Response {
    if let Err(response) = verify_token(&state, &token).await {
        return response;
    }
    let (sender, receiver) = mpsc::channel(32);
    tokio::spawn(async move {
        loop {
            for project in list_metadata(&state).await {
                let message = json!({
                    "projectId": project_number(&project),
                    "processing": processing(&project),
                });
                let event = Event::default().data(message.to_string());
                if sender.send(Ok::<Event, Infallible>(event)).await.is_err() {
                    return;
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
    });
    Sse::new(ReceiverStream::new(receiver))
        .keep_alive(KeepAlive::default())
        .into_response()
}

async fn project_realtime(
    State(state): State<ApiState>,
    RequestPath((token, project_id)): RequestPath<(String, String)>,
    websocket: WebSocketUpgrade,
) -> Response {
    match get_required_project(&state, &token, &project_id).await {
        Ok(project) => websocket
            .on_upgrade(move |socket| run_realtime(socket, state, project))
            .into_response(),
        Err(response) => response,
    }
}

struct RecordingSession {
    id: String,
    metadata_path: PathBuf,
    project: Value,
    sample_rate: u32,
    frame_count: u64,
    file: fs::File,
}

fn create_recording_wav_header(sample_rate: u32, frame_count: u64) -> Option<Vec<u8>> {
    let data_length = frame_count.checked_mul(2)?;
    let data_length = u32::try_from(data_length).ok()?;
    let file_length = data_length.checked_add(36)?;
    let byte_rate = sample_rate.checked_mul(2)?;
    let mut header = Vec::with_capacity(WAV_HEADER_BYTE_LENGTH as usize);
    header.extend_from_slice(b"RIFF");
    header.extend_from_slice(&file_length.to_le_bytes());
    header.extend_from_slice(b"WAVEfmt ");
    header.extend_from_slice(&16_u32.to_le_bytes());
    header.extend_from_slice(&1_u16.to_le_bytes());
    header.extend_from_slice(&1_u16.to_le_bytes());
    header.extend_from_slice(&sample_rate.to_le_bytes());
    header.extend_from_slice(&byte_rate.to_le_bytes());
    header.extend_from_slice(&2_u16.to_le_bytes());
    header.extend_from_slice(&16_u16.to_le_bytes());
    header.extend_from_slice(b"data");
    header.extend_from_slice(&data_length.to_le_bytes());
    Some(header)
}

fn read_recording_start(event: &Value) -> Option<(u32, u64)> {
    let sample_rate = event.get("sampleRate")?.as_u64()?;
    let frame_count = event.get("frameCount")?.as_u64()?;
    if sample_rate == 0 || sample_rate > u64::from(u32::MAX) {
        return None;
    }
    if frame_count == 0 || frame_count > MAX_RECORDING_FRAME_COUNT {
        return None;
    }
    Some((sample_rate as u32, frame_count))
}

async fn start_recording_session(
    state: &ServerState,
    project: Value,
    sample_rate: u32,
    frame_count: u64,
) -> Result<RecordingSession, String> {
    let id = create_project_id();
    let Some(project_id) = project_path(&project) else {
        return Err("invalid project metadata".to_owned());
    };
    let directory = state
        .paths
        .root
        .join("projects")
        .join(project_id)
        .join("recordings");
    fs::create_dir_all(&directory)
        .await
        .map_err(|error| error.to_string())?;
    let path = directory.join(format!("{}.wav", id));
    let header = create_recording_wav_header(sample_rate, frame_count)
        .ok_or_else(|| "recording is too large".to_owned())?;
    let mut file = fs::File::create(&path)
        .await
        .map_err(|error| error.to_string())?;
    file.write_all(&header)
        .await
        .map_err(|error| error.to_string())?;
    file.set_len(WAV_HEADER_BYTE_LENGTH + frame_count * 2)
        .await
        .map_err(|error| error.to_string())?;
    let metadata_path = state
        .paths
        .root
        .join("projects")
        .join(project_id)
        .join("project.json");
    Ok(RecordingSession {
        id,
        metadata_path,
        project,
        sample_rate,
        frame_count,
        file,
    })
}

async fn write_recording_packet(
    session: &mut RecordingSession,
    packet: &[u8],
) -> Result<(), String> {
    if packet.len() < 8 {
        return Err("recording packet is missing a header".to_owned());
    }
    let frame_index = u32::from_le_bytes(
        packet[0..4]
            .try_into()
            .map_err(|_| "recording packet is invalid".to_owned())?,
    );
    let frame_count = u32::from_le_bytes(
        packet[4..8]
            .try_into()
            .map_err(|_| "recording packet is invalid".to_owned())?,
    );
    let sample_bytes = usize::try_from(frame_count)
        .ok()
        .and_then(|value| value.checked_mul(4))
        .ok_or_else(|| "recording packet is too large".to_owned())?;
    if packet.len() != 8 + sample_bytes {
        return Err("recording packet has invalid length".to_owned());
    }
    let frame_index = u64::from(frame_index);
    if frame_index >= session.frame_count {
        return Ok(());
    }
    let frame_count = u64::from(frame_count).min(session.frame_count - frame_index);
    let mut pcm = Vec::with_capacity(frame_count as usize * 2);
    for sample in packet[8..].chunks_exact(4).take(frame_count as usize) {
        let value = f32::from_le_bytes([sample[0], sample[1], sample[2], sample[3]]);
        let value = value.clamp(-1.0, 1.0);
        let pcm_value = if value < 0.0 {
            (value * 32_768.0) as i16
        } else {
            (value * 32_767.0) as i16
        };
        pcm.extend_from_slice(&pcm_value.to_le_bytes());
    }
    session
        .file
        .seek(std::io::SeekFrom::Start(
            WAV_HEADER_BYTE_LENGTH + frame_index * 2,
        ))
        .await
        .map_err(|error| error.to_string())?;
    session
        .file
        .write_all(&pcm)
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

async fn finish_recording_session(mut session: RecordingSession) -> Result<(), String> {
    session
        .file
        .flush()
        .await
        .map_err(|error| error.to_string())?;
    let size = WAV_HEADER_BYTE_LENGTH + session.frame_count * 2;
    let project_id = project_path(&session.project)
        .ok_or_else(|| "invalid project metadata".to_owned())?
        .to_owned();
    let recording = json!({
        "id": session.id,
        "path": format!("projects/{}/recordings/{}.wav", project_id, session.id),
        "filename": "Vocal take.wav",
        "contentType": "audio/wav",
        "size": size,
        "sampleRate": session.sample_rate,
        "createdAt": chrono::Utc::now().to_rfc3339(),
    });
    let recordings = session
        .project
        .as_object_mut()
        .ok_or_else(|| "invalid project metadata".to_owned())?
        .entry("recordings")
        .or_insert_with(|| json!([]));
    let recordings = recordings
        .as_array_mut()
        .ok_or_else(|| "invalid project recordings".to_owned())?;
    recordings.push(recording);
    session.project["updatedAt"] = Value::String(chrono::Utc::now().to_rfc3339());
    let encoded = serde_json::to_vec(&session.project).map_err(|error| error.to_string())?;
    fs::write(session.metadata_path, encoded)
        .await
        .map_err(|error| error.to_string())
}

fn realtime_error(message: &str) -> Value {
    json!({ "type": "error", "error": message })
}

async fn run_realtime(socket: WebSocket, state: ApiState, project: Value) {
    let (mut sender, mut receiver) = socket.split();
    let mut recording: Option<RecordingSession> = None;
    let initial = json!({
        "type": "player.sync.state",
        "active": false,
        "recording": false,
        "frozen": false,
        "frameIndex": 0,
        "revision": 0,
    });
    if sender
        .send(Message::Text(initial.to_string().into()))
        .await
        .is_err()
    {
        return;
    }
    while let Some(Ok(message)) = receiver.next().await {
        match message {
            Message::Binary(packet) => {
                let result = match recording.as_mut() {
                    Some(session) => write_recording_packet(session, &packet).await,
                    None => Err("recording packet must follow recording start".to_owned()),
                };
                if let Err(error) = result {
                    let event = realtime_error(&error);
                    if sender
                        .send(Message::Text(event.to_string().into()))
                        .await
                        .is_err()
                    {
                        return;
                    }
                }
            }
            Message::Close(_) => return,
            Message::Text(message) => {
                let Ok(event) = serde_json::from_str::<Value>(&message) else {
                    continue;
                };
                let response = match event.get("type").and_then(Value::as_str) {
                    Some("recording.start") => match read_recording_start(&event) {
                        Some((sample_rate, frame_count)) => {
                            if let Some(session) = recording.take() {
                                let _ = finish_recording_session(session).await;
                            }
                            match start_recording_session(
                                &state,
                                project.clone(),
                                sample_rate,
                                frame_count,
                            )
                            .await
                            {
                                Ok(session) => {
                                    recording = Some(session);
                                    Some(json!({ "type": "recording.started" }))
                                }
                                Err(error) => Some(realtime_error(&error)),
                            }
                        }
                        None => Some(realtime_error("recording start is invalid")),
                    },
                    Some("recording.finish") => match recording.take() {
                        Some(session) => match finish_recording_session(session).await {
                            Ok(()) => Some(json!({ "type": "recording.finished" })),
                            Err(error) => Some(realtime_error(&error)),
                        },
                        None => Some(json!({ "type": "recording.finished" })),
                    },
                    Some("player.sync.request") => Some(initial.clone()),
                    _ => None,
                };
                if let Some(response) = response {
                    if sender
                        .send(Message::Text(response.to_string().into()))
                        .await
                        .is_err()
                    {
                        return;
                    }
                }
            }
            Message::Ping(_) | Message::Pong(_) => {}
        }
    }
}
