use std::sync::Arc;

use axum::{
    Router,
    body::Body,
    extract::{Path, State},
    http::{HeaderMap, Request},
    response::Response,
    routing::{MethodRouter, get},
};
use musetric_db::Analysis;

use crate::{
    blob_response::{CachedBlob, send_cached},
    failure::{Failure, finish, invalid_number},
    routes::RouteState,
    storage::{Storage, read},
};

const CONTENT_TYPE_JSON: &str = "application/json";
const PROJECT_ID: &str = "projectId";

pub(crate) fn create_router() -> Router<RouteState> {
    Router::new()
        .route(
            "/api/chords/project/{projectId}",
            create_route(Analysis::Chords),
        )
        .route("/api/key/project/{projectId}", create_route(Analysis::Key))
        .route(
            "/api/rhythm/project/{projectId}",
            create_route(Analysis::Rhythm),
        )
        .route(
            "/api/subtitle/project/{projectId}",
            create_route(Analysis::Subtitle),
        )
}

fn create_route(analysis: Analysis) -> MethodRouter<RouteState> {
    get(
        move |State(state): State<RouteState>,
              Path(project_id): Path<String>,
              request: Request<Body>| async move {
            handle(analysis, state, &project_id, request).await
        },
    )
}

async fn handle(
    analysis: Analysis,
    state: RouteState,
    raw_project_id: &str,
    request: Request<Body>,
) -> Response<Body> {
    let Ok(project_id) = raw_project_id.parse::<i64>() else {
        return finish(Err(invalid_number(PROJECT_ID)));
    };
    finish(send(analysis, &state.storage, project_id, request.headers()).await)
}

async fn send(
    analysis: Analysis,
    storage: &Arc<Storage>,
    project_id: i64,
    request: &HeaderMap,
) -> Result<Response<Body>, Failure> {
    let blob = read_blob(analysis, storage, project_id).await?;
    send_cached(storage, request, blob).await
}

async fn read_blob(
    analysis: Analysis,
    storage: &Arc<Storage>,
    project_id: i64,
) -> Result<CachedBlob, Failure> {
    let (found_blob, found_project) = read(storage, move |database| {
        Ok((
            database.analysis_blob(analysis, project_id)?,
            database.project_name(project_id)?,
        ))
    })
    .await?;
    let title = analysis.table();
    let blob_id = found_blob
        .ok_or_else(|| Failure::NotFound(format!("{title} for project {project_id} not found")))?;
    let project_name = found_project
        .ok_or_else(|| Failure::NotFound(format!("Project with id {project_id} not found")))?;
    Ok(CachedBlob {
        blob_id,
        filename: format!("{project_name}_{}.json", title.to_ascii_lowercase()),
        content_type: CONTENT_TYPE_JSON.to_owned(),
        missing_message: format!("{title} blob for project {project_id} not found"),
    })
}
