use axum::{Json, Router, extract::State, routing::get};
use serde_json::{Value, json};

use crate::{analysis::models::download_size, routes::RouteState};

pub(crate) fn create_router() -> Router<RouteState> {
    Router::new().route("/api/models/download", get(handle))
}

async fn handle(State(state): State<RouteState>) -> Json<Value> {
    let size = download_size(&state.models_path).await;
    Json(json!({
        "totalBytes": size.total_bytes,
        "missingBytes": size.missing_bytes,
    }))
}
