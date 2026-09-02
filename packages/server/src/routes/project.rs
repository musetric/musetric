use std::{path::Path as FilePath, sync::Arc};

use axum::{
    Router,
    body::{Body, to_bytes},
    extract::{DefaultBodyLimit, FromRequest, Multipart, Path, State},
    http::{Request, StatusCode},
    response::Response,
    routing::{delete, get, patch, post},
};
use musetric_db::{NewPreview, NewProject, ProcessingStep, ProjectEdit, blob_path};
use musetric_media::{convert_to_flac, read_frame_count};
use serde_json::Value;

use crate::{
    blobs::{create_blob_ref, discard_blob},
    failure::{Failure, finish},
    form::{Field, Form, UploadedFile, read_form},
    proxy::forward,
    routes::{
        RouteState,
        item::{json_response, missing_message, read_items, respond_with_item},
    },
    storage::{Storage, read, write},
};

const UPLOAD_LIMIT: usize = 200 * 1024 * 1024;
const RETRY_LIMIT: usize = 4 * 1024;
const SAMPLE_RATE: u32 = 48000;
const NAME_MIN_LENGTH: usize = 3;
const INVALID_AUDIO: &str = "Uploaded audio file is invalid";
const SHORT_NAME: &str = "body/name Too small: expected string to have >=3 characters";

pub(crate) fn create_router() -> Router<RouteState> {
    Router::new()
        .route("/api/project/list", get(handle_list))
        .route("/api/project/{projectId}", get(handle_get))
        .route("/api/project/{projectId}/retry", post(handle_retry))
        .route("/api/project/create", post(handle_create))
        .route("/api/project/{projectId}/edit", patch(handle_edit))
        .route("/api/project/{projectId}/remove", delete(handle_remove))
        .layer(DefaultBodyLimit::max(UPLOAD_LIMIT))
}

async fn handle_list(State(state): State<RouteState>) -> Response<Body> {
    finish(read_items(&state).await.map(|items| json_response(&items)))
}

async fn handle_get(
    State(state): State<RouteState>,
    Path(raw_project_id): Path<String>,
    request: Request<Body>,
) -> Response<Body> {
    let Ok(project_id) = raw_project_id.parse::<i64>() else {
        return forward(&state.proxy, request).await;
    };
    respond_with_item(&state, project_id).await
}

async fn handle_retry(
    State(state): State<RouteState>,
    Path(raw_project_id): Path<String>,
    request: Request<Body>,
) -> Response<Body> {
    let Ok(project_id) = raw_project_id.parse::<i64>() else {
        return forward(&state.proxy, request).await;
    };
    let (parts, body) = request.into_parts();
    let payload = match to_bytes(body, RETRY_LIMIT).await {
        Ok(payload) => payload,
        Err(error) => return finish(Err(Failure::failed(error))),
    };
    let Some(step) = read_step(&payload) else {
        let forwarded = Request::from_parts(parts, Body::from(payload));
        return forward(&state.proxy, forwarded).await;
    };
    match retry(&state, project_id, step).await {
        Ok(()) => respond_with_item(&state, project_id).await,
        Err(failure) => finish(Err(failure)),
    }
}

fn read_step(payload: &[u8]) -> Option<ProcessingStep> {
    let body: Value = serde_json::from_slice(payload).ok()?;
    ProcessingStep::parse(body.get("step")?.as_str()?)
}

async fn retry(state: &RouteState, project_id: i64, step: ProcessingStep) -> Result<(), Failure> {
    let found = read(&state.storage, move |reader| reader.project(project_id)).await?;
    if found.is_none() {
        return Err(Failure::NotFound(missing_message(project_id)));
    }
    let failures = read(&state.storage, move |reader| {
        reader.step_failures(project_id)
    })
    .await?;
    if !failures.iter().any(|failure| failure.step == step) {
        return Err(Failure::NotFound(format!(
            "Processing step {} is not failed",
            step.name()
        )));
    }
    write(&state.storage, move |writer| {
        writer.clear_failure(project_id, step)
    })
    .await?;
    state.queue.wake();
    Ok(())
}

async fn handle_create(State(state): State<RouteState>, multipart: Multipart) -> Response<Body> {
    let form = match read_form(multipart, &state.storage.blobs_path).await {
        Ok(form) => form,
        Err(failure) => return finish(Err(failure)),
    };
    let created = create(&state, &form).await;
    if created.is_err() {
        form.discard(&state.storage.blobs_path).await;
    }
    match created {
        Ok(project_id) => {
            state.queue.wake();
            respond_with_item(&state, project_id).await
        }
        Err(failure) => finish(Err(failure)),
    }
}

async fn handle_edit(
    State(state): State<RouteState>,
    Path(raw_project_id): Path<String>,
    request: Request<Body>,
) -> Response<Body> {
    let Ok(project_id) = raw_project_id.parse::<i64>() else {
        return forward(&state.proxy, request).await;
    };
    let multipart = match Multipart::from_request(request, &()).await {
        Ok(multipart) => multipart,
        Err(rejection) => return finish(Err(Failure::failed(rejection.body_text()))),
    };
    let form = match read_form(multipart, &state.storage.blobs_path).await {
        Ok(form) => form,
        Err(failure) => return finish(Err(failure)),
    };
    let edited = edit(&state, project_id, &form).await;
    if edited.is_err() {
        form.discard(&state.storage.blobs_path).await;
    }
    match edited {
        Ok(()) => respond_with_item(&state, project_id).await,
        Err(failure) => finish(Err(failure)),
    }
}

async fn handle_remove(
    State(state): State<RouteState>,
    Path(raw_project_id): Path<String>,
    request: Request<Body>,
) -> Response<Body> {
    let Ok(project_id) = raw_project_id.parse::<i64>() else {
        return forward(&state.proxy, request).await;
    };
    finish(remove(&state, project_id).await)
}

async fn create(state: &RouteState, form: &Form) -> Result<i64, Failure> {
    let input = read_create_input(form)?;
    let song = normalize_song(&state.storage, &input.song.blob_id).await?;
    let project = NewProject {
        name: input.name,
        song_blob_id: song.blob_id,
        sample_rate: i64::from(SAMPLE_RATE),
        frame_count: song.frame_count,
        preview: input.preview.map(create_preview),
    };
    write(&state.storage, move |writer| {
        writer.create_project(&project)
    })
    .await
}

async fn edit(state: &RouteState, project_id: i64, form: &Form) -> Result<(), Failure> {
    let input = read_edit_input(form)?;
    let change = ProjectEdit {
        project_id,
        name: input.name,
        preview: input.preview.map(create_preview),
        without_preview: input.without_preview,
    };
    let found = write(&state.storage, move |writer| writer.edit_project(&change)).await?;
    if found {
        return Ok(());
    }
    Err(Failure::NotFound(missing_message(project_id)))
}

async fn remove(state: &RouteState, project_id: i64) -> Result<Response<Body>, Failure> {
    let removed = write(&state.storage, move |writer| {
        writer.remove_project(project_id)
    })
    .await?;
    if !removed {
        return Err(Failure::NotFound(missing_message(project_id)));
    }
    let mut response = Response::new(Body::empty());
    *response.status_mut() = StatusCode::OK;
    Ok(response)
}

fn create_preview(file: &UploadedFile) -> NewPreview {
    NewPreview {
        blob_id: file.blob_id.clone(),
        filename: file.filename.clone(),
        content_type: file.content_type.clone(),
    }
}

struct CreateInput<'form> {
    song: &'form UploadedFile,
    name: String,
    preview: Option<&'form UploadedFile>,
}

fn read_create_input(form: &Form) -> Result<CreateInput<'_>, Failure> {
    let mut issues = Vec::new();
    let uploaded_song = read_file(form, "song", &mut issues, true);
    let given_name = read_name(form, &mut issues, true);
    let preview = read_file(form, "preview", &mut issues, false);
    match (uploaded_song, given_name) {
        (Some(song), Some(name)) if issues.is_empty() => Ok(CreateInput {
            song,
            name,
            preview,
        }),
        _ => Err(Failure::Invalid(issues.join(", "))),
    }
}

struct EditInput<'form> {
    name: Option<String>,
    preview: Option<&'form UploadedFile>,
    without_preview: bool,
}

fn read_edit_input(form: &Form) -> Result<EditInput<'_>, Failure> {
    let mut issues = Vec::new();
    let name = read_name(form, &mut issues, false);
    let preview = read_file(form, "preview", &mut issues, false);
    let without_preview = read_without_preview(form, &mut issues);
    if issues.is_empty() {
        return Ok(EditInput {
            name,
            preview,
            without_preview,
        });
    }
    Err(Failure::Invalid(issues.join(", ")))
}

fn read_file<'form>(
    form: &'form Form,
    name: &str,
    issues: &mut Vec<String>,
    required: bool,
) -> Option<&'form UploadedFile> {
    match form.field(name) {
        Field::File(file) => Some(file),
        Field::Missing if !required => None,
        other => {
            issues.push(format!(
                "body/{name} Invalid input: expected file, received {}",
                other.describe()
            ));
            None
        }
    }
}

fn read_name(form: &Form, issues: &mut Vec<String>, required: bool) -> Option<String> {
    match form.field("name") {
        Field::Text(value) if value.encode_utf16().count() >= NAME_MIN_LENGTH => {
            Some(value.to_owned())
        }
        Field::Text(_) => {
            issues.push(SHORT_NAME.to_owned());
            None
        }
        Field::Missing if !required => None,
        other => {
            issues.push(format!(
                "body/name Invalid input: expected string, received {}",
                other.describe()
            ));
            None
        }
    }
}

fn read_without_preview(form: &Form, issues: &mut Vec<String>) -> bool {
    match form.field("withoutPreview") {
        Field::Text("true") => true,
        Field::Text("false") | Field::Missing => false,
        other => {
            issues.push(format!(
                "body/withoutPreview Invalid input: expected boolean, received {}",
                other.describe()
            ));
            false
        }
    }
}

struct NormalizedSong {
    blob_id: String,
    frame_count: i64,
}

async fn normalize_song(
    storage: &Arc<Storage>,
    uploaded_blob_id: &str,
) -> Result<NormalizedSong, Failure> {
    let normalized = create_blob_ref(&storage.blobs_path);
    let uploaded_path = blob_path(&storage.blobs_path, uploaded_blob_id);
    let measured = convert_and_measure(storage, &uploaded_path, &normalized.path).await;
    let Some(frame_count) = measured else {
        discard_blob(&storage.blobs_path, &normalized.blob_id).await;
        return Err(Failure::Invalid(INVALID_AUDIO.to_owned()));
    };
    discard_blob(&storage.blobs_path, uploaded_blob_id).await;
    Ok(NormalizedSong {
        blob_id: normalized.blob_id,
        frame_count,
    })
}

async fn convert_and_measure(
    storage: &Arc<Storage>,
    from: &FilePath,
    to: &FilePath,
) -> Option<i64> {
    convert_to_flac(&storage.tools, from, to, SAMPLE_RATE)
        .await
        .ok()?;
    let frames = read_frame_count(&storage.tools, to, SAMPLE_RATE)
        .await
        .ok()?;
    i64::try_from(frames).ok()
}
