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
    loop {
        let update = tokio::select! {
            received = events.recv() => received,
            () = sleep(HEARTBEAT) => return Some((Ok(PING.to_owned()), events)),
        };
        match update {
            Ok(event) => return Some((Ok(encode(&event)), events)),
            Err(RecvError::Lagged(_)) => {}
            Err(RecvError::Closed) => return None,
        }
    }
}

fn encode(event: &StatusEvent) -> String {
    let payload = json!({
        "projectId": event.project_id,
        "processing": build_processing(&event.processing),
    });
    format!("data: {payload}\n\n")
}

#[cfg(test)]
mod tests {
    use musetric_jobs::{Processing, StatusEvent, StepPass, StepPhase, StepStatus, StepView};

    use super::encode;

    const EXPECTED: &str = "data: {\"processing\":{\"done\":false,\"steps\":{\
\"chords\":{\"status\":\"pending\"},\
\"key\":{\"decoded\":441000,\"phase\":\"decoding\",\"status\":\"processing\",\"total\":1764000},\
\"rhythm\":{\"phase\":\"saving\",\"status\":\"processing\"},\
\"separation\":{\"status\":\"done\"},\
\"transcription\":{\"pass\":\"decode\",\"phase\":\"running\",\"status\":\"processing\",\
\"unit\":3,\"unitCount\":12}}},\"projectId\":7}\n\n";

    fn create_step(status: StepStatus, phase: Option<StepPhase>) -> StepView {
        StepView {
            status,
            phase,
            error: None,
        }
    }

    #[test]
    fn encodes_an_update_as_a_single_server_sent_event() {
        let event = StatusEvent {
            project_id: 7,
            processing: Processing {
                done: false,
                steps: [
                    create_step(StepStatus::Done, None),
                    create_step(
                        StepStatus::Processing,
                        Some(StepPhase::Running {
                            pass: StepPass::Decode,
                            unit: 3,
                            unit_count: 12,
                        }),
                    ),
                    create_step(StepStatus::Processing, Some(StepPhase::Saving)),
                    create_step(
                        StepStatus::Processing,
                        Some(StepPhase::Decoding {
                            decoded: 441_000,
                            total: 1_764_000,
                        }),
                    ),
                    create_step(StepStatus::Pending, None),
                ],
            },
        };

        assert_eq!(encode(&event), EXPECTED);
    }
}
