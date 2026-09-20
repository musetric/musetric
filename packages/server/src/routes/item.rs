use axum::{
    body::Body,
    http::{HeaderValue, header::CONTENT_TYPE},
    response::Response,
};
use musetric_db::{ProjectItem, StemLoudness};
use musetric_jobs::{Processing, STEP_ORDER, StepPhase, StepView, StepWait};
use serde_json::{Map, Value, json};

use crate::{
    analysis::{Gains, read_gains},
    failure::{Failure, finish},
    routes::RouteState,
    storage::read,
};

const CONTENT_TYPE_JSON: &str = "application/json; charset=utf-8";

pub(crate) fn missing_message(project_id: i64) -> String {
    format!("Project with id {project_id} not found")
}

pub(crate) fn json_response(payload: &Value) -> Response<Body> {
    let mut response = Response::new(Body::from(payload.to_string()));
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static(CONTENT_TYPE_JSON));
    response
}

pub(crate) async fn respond_with_item(state: &RouteState, project_id: i64) -> Response<Body> {
    finish(
        read_item(state, project_id)
            .await
            .map(|item| json_response(&item)),
    )
}

pub(crate) async fn read_item(state: &RouteState, project_id: i64) -> Result<Value, Failure> {
    let found = read(&state.storage, move |reader| reader.project(project_id)).await?;
    let project = found.ok_or_else(|| Failure::NotFound(missing_message(project_id)))?;
    load_item(state, &project).await
}

pub(crate) async fn read_items(state: &RouteState) -> Result<Value, Failure> {
    let overview = read(&state.storage, musetric_db::Reader::project_overview).await?;
    let mut items = Vec::with_capacity(overview.projects.len());
    for project in &overview.projects {
        let measured = overview
            .loudness
            .get(&project.id)
            .map_or(&[][..], Vec::as_slice);
        let states = overview
            .states
            .get(&project.id)
            .map_or(&[][..], Vec::as_slice);
        let processing = state
            .queue
            .summarize(project.id, states)
            .map_err(Failure::failed)?;
        items.push(build_item(project, measured, &processing));
    }
    Ok(Value::Array(items))
}

async fn load_item(state: &RouteState, project: &ProjectItem) -> Result<Value, Failure> {
    let project_id = project.id;
    let measured = read(&state.storage, move |reader| {
        reader.stem_loudness(project_id)
    })
    .await?;
    let processing = state
        .queue
        .processing(project_id)
        .await
        .map_err(Failure::failed)?;
    Ok(build_item(project, &measured, &processing))
}

fn build_item(project: &ProjectItem, measured: &[StemLoudness], processing: &Processing) -> Value {
    let mut item = Map::new();
    item.insert("id".to_owned(), json!(project.id));
    item.insert("name".to_owned(), json!(project.name));
    item.insert("sampleRate".to_owned(), json!(project.sample_rate));
    item.insert("frameCount".to_owned(), json!(project.frame_count));
    item.insert("paused".to_owned(), json!(project.paused));
    item.insert("position".to_owned(), json!(project.position));
    if let Some(preview_id) = project.preview_id {
        item.insert(
            "previewUrl".to_owned(),
            json!(format!("/api/preview/{preview_id}")),
        );
    }
    if let Some(gains) = read_gains(measured) {
        item.insert("audioAnalysis".to_owned(), build_analysis(&gains));
    }
    item.insert("processing".to_owned(), build_processing(processing));
    Value::Object(item)
}

fn build_analysis(gains: &Gains) -> Value {
    json!({
        "sourceGainDb": gains.source,
        "leadSpectrogramGainDb": gains.lead_spectrogram,
        "practiceGainsDb": {
            "lead": gains.lead,
            "backing": gains.backing,
            "instrumental": gains.instrumental,
        },
    })
}

pub(crate) fn build_processing(processing: &Processing) -> Value {
    let mut steps = Map::new();
    for step in STEP_ORDER {
        steps.insert(step.name().to_owned(), build_step(processing.step(step)));
    }
    json!({ "done": processing.done, "steps": Value::Object(steps) })
}

fn build_step(step: &StepView) -> Value {
    let mut view = Map::new();
    view.insert("status".to_owned(), json!(step.status.name()));
    if let Some(phase) = step.phase.as_ref() {
        view.insert("phase".to_owned(), json!(phase.name()));
        describe_phase(phase, &mut view);
    }
    if let Some(error) = step.error.as_ref() {
        view.insert("error".to_owned(), json!(error));
    }
    if let Some(wait) = step.wait {
        view.insert("waiting".to_owned(), build_wait(wait));
    }
    Value::Object(view)
}

fn build_wait(wait: StepWait) -> Value {
    let mut view = Map::new();
    view.insert("reason".to_owned(), json!(wait.reason.name()));
    view.insert("attempt".to_owned(), json!(wait.attempt));
    if let Some(limit) = wait.limit {
        view.insert("limit".to_owned(), json!(limit));
    }
    Value::Object(view)
}

fn describe_phase(phase: &StepPhase, view: &mut Map<String, Value>) {
    match phase {
        StepPhase::Preparing { download } => {
            if let Some(announced) = download.as_ref() {
                view.insert("download".to_owned(), announced.clone());
            }
        }
        StepPhase::Decoding { decoded, total } => {
            view.insert("decoded".to_owned(), json!(decoded));
            view.insert("total".to_owned(), json!(total));
        }
        StepPhase::Running {
            pass,
            unit,
            unit_count,
        } => {
            view.insert("pass".to_owned(), json!(pass.name()));
            view.insert("unit".to_owned(), json!(unit));
            view.insert("unitCount".to_owned(), json!(unit_count));
        }
        StepPhase::Loading | StepPhase::Saving => {}
    }
}
