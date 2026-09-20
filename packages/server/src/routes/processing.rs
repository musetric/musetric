use axum::{
    Router,
    body::{Body, to_bytes},
    extract::{Path, Request, State},
    http::StatusCode,
    response::Response,
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::json;

use crate::{
    failure::{Failure, finish},
    routes::{
        RouteState,
        item::{json_response, missing_message},
    },
    storage::{read, write},
};

const BODY_LIMIT: usize = 64 * 1024;
const PROJECT_ID: &str = "projectId";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PauseBody {
    paused: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct OrderBody {
    project_ids: Vec<i64>,
}

pub(crate) fn create_router() -> Router<RouteState> {
    Router::new()
        .route("/api/processing", get(handle_read))
        .route("/api/processing/pause", post(handle_pause))
        .route("/api/processing/order", post(handle_order))
        .route("/api/project/{projectId}/pause", post(handle_project_pause))
}

async fn handle_read(State(state): State<RouteState>) -> Response<Body> {
    let found = read(&state.storage, musetric_db::Reader::processing_paused).await;
    finish(found.map(|paused| json_response(&json!({ "paused": paused }))))
}

async fn handle_pause(State(state): State<RouteState>, request: Request<Body>) -> Response<Body> {
    finish(pause(&state, request).await)
}

async fn pause(state: &RouteState, request: Request<Body>) -> Result<Response<Body>, Failure> {
    let asked: PauseBody = read_body(request).await?;
    write(&state.storage, move |writer| {
        writer.set_processing_paused(asked.paused)
    })
    .await?;
    state.queue.pause_changed();
    if asked.paused {
        state.executor.reload_executor();
    }
    Ok(empty_response())
}

async fn handle_project_pause(
    State(state): State<RouteState>,
    Path(raw_project_id): Path<String>,
    request: Request<Body>,
) -> Response<Body> {
    finish(project_pause(&state, &raw_project_id, request).await)
}

async fn project_pause(
    state: &RouteState,
    raw_project_id: &str,
    request: Request<Body>,
) -> Result<Response<Body>, Failure> {
    let project_id = read_project_id(raw_project_id)?;
    let asked: PauseBody = read_body(request).await?;
    let found = write(&state.storage, move |writer| {
        writer.set_project_paused(project_id, asked.paused)
    })
    .await?;
    if !found {
        return Err(Failure::NotFound(missing_message(project_id)));
    }
    state.queue.pause_changed();
    Ok(empty_response())
}

async fn handle_order(State(state): State<RouteState>, request: Request<Body>) -> Response<Body> {
    finish(order(&state, request).await)
}

async fn order(state: &RouteState, request: Request<Body>) -> Result<Response<Body>, Failure> {
    let asked: OrderBody = read_body(request).await?;
    write(&state.storage, move |writer| {
        writer.set_project_order(&asked.project_ids)
    })
    .await?;
    state.queue.wake();
    Ok(empty_response())
}

fn read_project_id(raw: &str) -> Result<i64, Failure> {
    raw.parse()
        .map_err(|_| Failure::Invalid(format!("path/{PROJECT_ID} Invalid input: expected number")))
}

async fn read_body<T: for<'de> Deserialize<'de>>(request: Request<Body>) -> Result<T, Failure> {
    let payload = to_bytes(request.into_body(), BODY_LIMIT)
        .await
        .map_err(Failure::failed)?;
    serde_json::from_slice(&payload).map_err(|error| Failure::Invalid(format!("body {error}")))
}

fn empty_response() -> Response<Body> {
    let mut response = Response::new(Body::empty());
    *response.status_mut() = StatusCode::OK;
    response
}
