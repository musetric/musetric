use axum::{
    Router,
    body::{Body, to_bytes},
    extract::{Path, State},
    http::Request,
    response::Response,
    routing::{delete, get, patch, post},
};
use musetric_db::{BoxedError, RecordingOutcome, Writer};
use serde_json::{Value, json};

use crate::{
    failure::{Failure, finish, invalid_number},
    realtime::{announce_recordings, recording_item},
    recording::read_recordings,
    routes::{
        RouteState,
        item::{json_response, missing_message},
    },
    storage::{read, write},
};

const BODY_LIMIT: usize = 4 * 1024;
const NAME_MAX_LENGTH: usize = 64;
const PROJECT_ID: &str = "projectId";
const RECORDING_ID: &str = "recordingId";
const NAME_FIELD: &str = "name";
const MISSING_NAME: &str = "body/name Invalid input: expected string, received undefined";
const SHORT_NAME: &str = "body/name Too small: expected string to have >=1 characters";
const LONG_NAME: &str = "body/name Too big: expected string to have <=64 characters";
const TAKEN_NAME: &str = "Another recording of this project already has this name";
const LAST_RECORDING: &str = "A project keeps at least one recording";
const BUSY: &str = "A take is being recorded or saved in this project";

pub(crate) fn create_router() -> Router<RouteState> {
    Router::new()
        .route("/api/project/{projectId}/recording/list", get(handle_list))
        .route(
            "/api/project/{projectId}/recording/create",
            post(handle_create),
        )
        .route(
            "/api/project/{projectId}/recording/{recordingId}/edit",
            patch(handle_edit),
        )
        .route(
            "/api/project/{projectId}/recording/{recordingId}/activate",
            post(handle_activate),
        )
        .route(
            "/api/project/{projectId}/recording/{recordingId}/remove",
            delete(handle_remove),
        )
}

pub(crate) fn read_ids(
    raw_project_id: &str,
    raw_recording_id: &str,
) -> Result<(i64, i64), Failure> {
    let project_id = raw_project_id
        .parse::<i64>()
        .map_err(|_| invalid_number(PROJECT_ID))?;
    let recording_id = raw_recording_id
        .parse::<i64>()
        .map_err(|_| invalid_number(RECORDING_ID))?;
    Ok((project_id, recording_id))
}

pub(crate) fn missing_recording(project_id: i64, recording_id: i64) -> Failure {
    Failure::NotFound(format!(
        "Recording {recording_id} of project {project_id} not found"
    ))
}

async fn respond_with_list(state: &RouteState, project_id: i64) -> Result<Response<Body>, Failure> {
    let found = read(&state.storage, move |reader| {
        reader.project_name(project_id)
    })
    .await?;
    if found.is_none() {
        return Err(Failure::NotFound(missing_message(project_id)));
    }
    let recordings = read_recordings(&state.storage, project_id)
        .await
        .map_err(Failure::failed)?;
    let listed: Vec<Value> = recordings.iter().map(recording_item).collect();
    Ok(json_response(&json!({ "recordings": listed })))
}

async fn locked<Value>(
    state: &RouteState,
    project_id: i64,
    change: impl FnOnce(&Writer) -> Result<Value, BoxedError> + Send + 'static,
) -> Result<Value, Failure>
where
    Value: Send + 'static,
{
    let Some(editor) = state.rooms.begin_edit(project_id) else {
        return Err(Failure::Conflict(BUSY.to_owned()));
    };
    let written = write(&state.storage, change).await;
    state.rooms.end_session(project_id, editor);
    written
}

fn settle(
    outcome: RecordingOutcome,
    (project_id, recording_id): (i64, i64),
    refused: &str,
) -> Result<(), Failure> {
    match outcome {
        RecordingOutcome::Done => Ok(()),
        RecordingOutcome::Missing => Err(missing_recording(project_id, recording_id)),
        RecordingOutcome::Refused => Err(Failure::Conflict(refused.to_owned())),
    }
}

async fn announced(state: &RouteState, project_id: i64) -> Result<Response<Body>, Failure> {
    announce_recordings(&state.rooms, &state.storage, project_id).await;
    respond_with_list(state, project_id).await
}

async fn handle_list(
    State(state): State<RouteState>,
    Path(raw_project_id): Path<String>,
) -> Response<Body> {
    let Ok(project_id) = raw_project_id.parse::<i64>() else {
        return finish(Err(invalid_number(PROJECT_ID)));
    };
    finish(respond_with_list(&state, project_id).await)
}

async fn handle_create(
    State(state): State<RouteState>,
    Path(raw_project_id): Path<String>,
) -> Response<Body> {
    let Ok(project_id) = raw_project_id.parse::<i64>() else {
        return finish(Err(invalid_number(PROJECT_ID)));
    };
    finish(create(&state, project_id).await)
}

async fn create(state: &RouteState, project_id: i64) -> Result<Response<Body>, Failure> {
    let created = locked(state, project_id, move |writer| {
        writer.create_recording(project_id)
    })
    .await?;
    if created.is_none() {
        return Err(Failure::NotFound(missing_message(project_id)));
    }
    announced(state, project_id).await
}

async fn handle_edit(
    State(state): State<RouteState>,
    Path((raw_project_id, raw_recording_id)): Path<(String, String)>,
    request: Request<Body>,
) -> Response<Body> {
    let (project_id, recording_id) = match read_ids(&raw_project_id, &raw_recording_id) {
        Ok(ids) => ids,
        Err(failure) => return finish(Err(failure)),
    };
    let payload = match to_bytes(request.into_body(), BODY_LIMIT).await {
        Ok(payload) => payload,
        Err(error) => return finish(Err(Failure::failed(error))),
    };
    let name = match read_name(&payload) {
        Ok(name) => name,
        Err(failure) => return finish(Err(failure)),
    };
    finish(edit(&state, project_id, recording_id, name).await)
}

fn read_name(payload: &[u8]) -> Result<String, Failure> {
    let asked = serde_json::from_slice::<Value>(payload)
        .ok()
        .and_then(|body| Some(body.get(NAME_FIELD)?.as_str()?.trim().to_owned()))
        .ok_or_else(|| Failure::Invalid(MISSING_NAME.to_owned()))?;
    if asked.is_empty() {
        return Err(Failure::Invalid(SHORT_NAME.to_owned()));
    }
    if asked.chars().count() > NAME_MAX_LENGTH {
        return Err(Failure::Invalid(LONG_NAME.to_owned()));
    }
    Ok(asked)
}

async fn edit(
    state: &RouteState,
    project_id: i64,
    recording_id: i64,
    name: String,
) -> Result<Response<Body>, Failure> {
    let outcome = write(&state.storage, move |writer| {
        writer.rename_recording(project_id, recording_id, &name)
    })
    .await?;
    settle(outcome, (project_id, recording_id), TAKEN_NAME)?;
    announced(state, project_id).await
}

async fn handle_activate(
    State(state): State<RouteState>,
    Path((raw_project_id, raw_recording_id)): Path<(String, String)>,
) -> Response<Body> {
    let (project_id, recording_id) = match read_ids(&raw_project_id, &raw_recording_id) {
        Ok(ids) => ids,
        Err(failure) => return finish(Err(failure)),
    };
    finish(activate(&state, project_id, recording_id).await)
}

async fn activate(
    state: &RouteState,
    project_id: i64,
    recording_id: i64,
) -> Result<Response<Body>, Failure> {
    let outcome = locked(state, project_id, move |writer| {
        writer.activate_recording(project_id, recording_id)
    })
    .await?;
    settle(outcome, (project_id, recording_id), BUSY)?;
    announced(state, project_id).await
}

async fn handle_remove(
    State(state): State<RouteState>,
    Path((raw_project_id, raw_recording_id)): Path<(String, String)>,
) -> Response<Body> {
    let (project_id, recording_id) = match read_ids(&raw_project_id, &raw_recording_id) {
        Ok(ids) => ids,
        Err(failure) => return finish(Err(failure)),
    };
    finish(remove(&state, project_id, recording_id).await)
}

async fn remove(
    state: &RouteState,
    project_id: i64,
    recording_id: i64,
) -> Result<Response<Body>, Failure> {
    let outcome = locked(state, project_id, move |writer| {
        writer.remove_recording(project_id, recording_id)
    })
    .await?;
    settle(outcome, (project_id, recording_id), LAST_RECORDING)?;
    announced(state, project_id).await
}
