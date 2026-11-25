use std::{convert::Infallible, time::Duration};

use axum::{
    Router,
    body::Body,
    extract::State,
    http::{
        HeaderValue,
        header::{CACHE_CONTROL, CONTENT_TYPE},
    },
    response::Response,
    routing::get,
};
use futures_util::stream::{StreamExt, iter, unfold};
use musetric_jobs::StatusEvent;
use serde_json::json;
use tokio::{
    sync::broadcast::{Receiver, error::RecvError},
    time::sleep,
};

use crate::routes::{RouteState, item::build_processing};

const CONTENT_TYPE_EVENTS: &str = "text/event-stream; charset=utf-8";
const CACHE_CONTROL_EVENTS: &str = "no-cache,no-transform";
const HEARTBEAT: Duration = Duration::from_secs(30);
const RETRY: &str = "retry: 3000\n\n";
const CONNECTED: &str = ": connected\n\n";
const PING: &str = "event: ping\n\n";

pub(crate) fn create_router() -> Router<RouteState> {
    Router::new().route("/api/project/status/stream", get(handle_status))
}

async fn handle_status(State(state): State<RouteState>) -> Response<Body> {
    let opening = iter([RETRY.to_owned(), CONNECTED.to_owned()].map(Ok::<String, Infallible>));
    let updates = unfold(state.queue.subscribe(), read_update);
    let mut response = Response::new(Body::from_stream(opening.chain(updates)));
    let headers = response.headers_mut();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static(CONTENT_TYPE_EVENTS));
    headers.insert(
        CACHE_CONTROL,
        HeaderValue::from_static(CACHE_CONTROL_EVENTS),
    );
    response
}

async fn read_update(
    mut events: Receiver<StatusEvent>,
) -> Option<(Result<String, Infallible>, Receiver<StatusEvent>)> {
    let update = tokio::select! {
        received = events.recv() => received,
        () = sleep(HEARTBEAT) => return Some((Ok(PING.to_owned()), events)),
    };
    match update {
        Ok(event) => Some((Ok(encode(&event)), events)),
        Err(RecvError::Lagged(_) | RecvError::Closed) => None,
    }
}

fn encode(event: &StatusEvent) -> String {
    let payload = json!({
        "projectId": event.project_id,
        "processing": build_processing(&event.processing),
    });
    format!("data: {payload}\n\n")
}
