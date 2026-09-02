use std::sync::Arc;

use axum::{
    Router,
    body::Body,
    extract::{Path, State},
    http::{HeaderMap, Request},
    response::Response,
    routing::get,
};

use crate::{
    blob_response::{CachedBlob, send_cached},
    failure::{Failure, finish},
    proxy::forward,
    routes::RouteState,
    storage::{Storage, read},
};

pub(crate) fn create_router() -> Router<RouteState> {
    Router::new().route("/api/preview/{previewId}", get(handle))
}

async fn handle(
    State(state): State<RouteState>,
    Path(raw_preview_id): Path<String>,
    request: Request<Body>,
) -> Response<Body> {
    let Ok(preview_id) = raw_preview_id.parse::<i64>() else {
        return forward(&state.proxy, request).await;
    };
    finish(send(&state.storage, preview_id, request.headers()).await)
}

async fn send(
    storage: &Arc<Storage>,
    preview_id: i64,
    request: &HeaderMap,
) -> Result<Response<Body>, Failure> {
    let found = read(storage, move |database| database.preview(preview_id)).await?;
    let preview = found
        .ok_or_else(|| Failure::NotFound(format!("Preview with id {preview_id} not found")))?;
    let blob = CachedBlob {
        blob_id: preview.blob_id,
        filename: preview.filename,
        content_type: preview.content_type,
        missing_message: format!("Preview blob for id {preview_id} not found"),
    };
    send_cached(storage, request, blob).await
}
