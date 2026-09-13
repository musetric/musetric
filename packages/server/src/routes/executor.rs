use axum::{Json, Router, extract::State, routing::get};
use serde_json::{Value, json};

use crate::routes::RouteState;

pub(crate) fn create_router() -> Router<RouteState> {
    Router::new().route("/api/executor", get(handle))
}

async fn handle(State(state): State<RouteState>) -> Json<Value> {
    Json(json!({ "url": state.executor.base_url() }))
}
