use axum::{
    body::Body,
    http::{Method, Request, StatusCode, header::CONTENT_TYPE},
};
use http_body_util::BodyExt;
use musetric_db::PendingJob;
use musetric_jobs::{StepAnswer, StepEvent, StepOutcome, StepReport, StepRunner};
use serde_json::{Value, json};

use crate::proxy::{ProxyState, forward};

const RUN_PATH: &str = "/api/internal/processing/run";
const CONTENT_TYPE_JSON: &str = "application/json";
const UNFINISHED: &str = "The processing step stopped without an answer";

pub(crate) struct UpstreamRunner {
    proxy: ProxyState,
}

impl UpstreamRunner {
    pub(crate) fn create(proxy: ProxyState) -> Self {
        Self { proxy }
    }
}

impl StepRunner for UpstreamRunner {
    fn run<'a>(&'a self, job: &'a PendingJob, report: &'a StepReport) -> StepOutcome<'a> {
        Box::pin(async move { run_step(&self.proxy, job, report).await })
    }
}

async fn run_step(proxy: &ProxyState, job: &PendingJob, report: &StepReport) -> StepAnswer {
    let payload = json!({
        "step": job.step.name(),
        "projectId": job.project_id,
        "blobId": job.blob_id,
    });
    let built = Request::builder()
        .method(Method::POST)
        .uri(RUN_PATH)
        .header(CONTENT_TYPE, CONTENT_TYPE_JSON)
        .body(Body::from(payload.to_string()));
    let Ok(request) = built else {
        return StepAnswer::Unavailable;
    };
    let response = forward(proxy, request).await;
    let status = response.status();
    let mut body = response.into_body();
    if status == StatusCode::BAD_GATEWAY {
        return StepAnswer::Unavailable;
    }
    if status != StatusCode::OK {
        return StepAnswer::Failed(read_rejection(status, &mut body).await);
    }
    read_messages(&mut body, report).await
}

async fn read_rejection(status: StatusCode, body: &mut Body) -> String {
    let mut text = String::new();
    while let Some(Ok(frame)) = body.frame().await {
        if let Some(chunk) = frame.data_ref() {
            text.push_str(&String::from_utf8_lossy(chunk));
        }
    }
    format!("The processing step was rejected with {status}: {text}")
}

async fn read_messages(body: &mut Body, report: &StepReport) -> StepAnswer {
    let mut pending = String::new();
    let mut answer = None;
    while let Some(received) = body.frame().await {
        let Ok(frame) = received else {
            return StepAnswer::Unavailable;
        };
        let Some(chunk) = frame.data_ref() else {
            continue;
        };
        pending.push_str(&String::from_utf8_lossy(chunk));
        while let Some(position) = pending.find('\n') {
            let line = pending.drain(..=position).collect::<String>();
            if let Some(finished) = read_message(line.trim(), report) {
                answer = Some(finished);
            }
        }
    }
    answer.unwrap_or(StepAnswer::Unavailable)
}

fn read_message(line: &str, report: &StepReport) -> Option<StepAnswer> {
    if line.is_empty() {
        return None;
    }
    let message: Value = serde_json::from_str(line).ok()?;
    match message.get("type").and_then(Value::as_str)? {
        "progress" => {
            let progress = message.get("progress").and_then(Value::as_f64)?;
            report(StepEvent::Progress(progress));
            None
        }
        "download" => {
            let download = message.get("download")?;
            report(StepEvent::Download(download.clone()));
            None
        }
        "done" => Some(StepAnswer::Finished),
        "failed" => Some(StepAnswer::Failed(
            message
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or(UNFINISHED)
                .to_owned(),
        )),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use std::convert::Infallible;

    use axum::{Router, body::Body, routing::post};
    use futures_util::stream::iter;
    use musetric_db::ProcessingStep;
    use musetric_jobs::StepStatus;
    use tokio::sync::oneshot;

    use crate::{
        proxy::ProxyState,
        test_workspace::{Workspace, create_route_state, start_upstream},
    };

    const CREATE_SOURCE: &str = "
      INSERT INTO Project (id, name, sampleRate, frameCount)
      VALUES (1, 'Fixture project', 48000, 480000);
      INSERT INTO AudioMaster (projectId, type, blobId) VALUES (1, 'source', 'source-blob');
    ";
    const HALF_DONE: [&str; 2] = [
        "{\"type\":\"progress\",\"progress\":0.25}\n{\"type\":\"pro",
        "gress\",\"progress\":0.5}\n{\"type\":\"done\"}\n",
    ];
    const REFUSED: [&str; 2] = [
        "{\"type\":\"progress\",\"progress\":0.25}\n",
        "{\"type\":\"failed\",\"error\":\"Separation failed\"}\n",
    ];

    async fn start_step_upstream(chunks: [&'static str; 2]) -> (String, oneshot::Sender<()>) {
        let app = Router::new().route(
            super::RUN_PATH,
            post(move || async move {
                Body::from_stream(iter(chunks.map(Ok::<&'static str, Infallible>)))
            }),
        );
        let (address, shutdown) = start_upstream(app).await;
        (format!("http://{address}"), shutdown)
    }

    #[tokio::test]
    async fn reports_the_progress_the_upstream_streams() {
        let workspace = Workspace::new();
        workspace.seed(CREATE_SOURCE);
        let (upstream, shutdown) = start_step_upstream(HALF_DONE).await;
        let address = upstream
            .parse()
            .expect("the upstream should be a valid uri");
        let state = create_route_state(ProxyState::create(address), workspace.create_storage());
        let mut events = state.queue.subscribe();

        state.queue.drain().await;

        let mut updates = Vec::new();
        while let Ok(event) = events.try_recv() {
            let step = event.processing.step(ProcessingStep::Separation);
            updates.push((step.status, step.progress));
        }
        let reported = updates
            .iter()
            .filter(|update| update.0 == StepStatus::Processing)
            .map(|update| update.1)
            .collect::<Vec<_>>();
        assert_eq!(reported, vec![Some(0.0), Some(0.25), Some(0.5)]);
        let failures = state
            .storage
            .database
            .step_failures(1)
            .expect("the failures should be read");
        assert!(failures.is_empty());
        let _ = shutdown.send(());
    }

    #[tokio::test]
    async fn records_the_failure_the_upstream_reports() {
        let workspace = Workspace::new();
        workspace.seed(CREATE_SOURCE);
        let (upstream, shutdown) = start_step_upstream(REFUSED).await;
        let address = upstream
            .parse()
            .expect("the upstream should be a valid uri");
        let state = create_route_state(ProxyState::create(address), workspace.create_storage());

        state.queue.drain().await;

        let failures = state
            .storage
            .database
            .step_failures(1)
            .expect("the failures should be read");
        assert_eq!(failures.len(), 1);
        assert_eq!(failures[0].step, ProcessingStep::Separation);
        assert_eq!(failures[0].message, "Separation failed");
        let _ = shutdown.send(());
    }
}
