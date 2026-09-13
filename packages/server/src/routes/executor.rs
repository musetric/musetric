use axum::{Json, Router, extract::State, routing::get};
use serde_json::{Value, json};

use crate::{routes::RouteState, serve::ExecutorSurface};

pub(crate) fn create_router() -> Router<RouteState> {
    Router::new().route("/api/executor", get(handle))
}

async fn handle(State(state): State<RouteState>) -> Json<Value> {
    Json(describe(state.executor.base_url(), state.executor_surface))
}

fn describe(url: &str, surface: ExecutorSurface) -> Value {
    json!({ "url": url, "surface": surface.name() })
}

#[cfg(test)]
mod tests {
    use super::describe;
    use crate::serve::ExecutorSurface;

    #[test]
    fn names_the_surface_that_owns_the_executor_document() {
        let shell = describe("http://127.0.0.1:7", ExecutorSurface::Shell);
        let page = describe("http://127.0.0.1:9", ExecutorSurface::Page);

        assert_eq!(shell["surface"], "shell");
        assert_eq!(shell["url"], "http://127.0.0.1:7");
        assert_eq!(page["surface"], "page");
    }
}
