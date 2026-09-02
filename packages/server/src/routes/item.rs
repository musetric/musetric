use axum::{
    body::Body,
    http::{HeaderValue, header::CONTENT_TYPE},
    response::Response,
};
use musetric_db::{AudioAnalysis, ProjectItem};
use musetric_jobs::{Processing, STEP_ORDER, StepView};
use serde_json::{Map, Value, json};

use crate::{
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
    build_item(state, &project).await
}

pub(crate) async fn read_items(state: &RouteState) -> Result<Value, Failure> {
    let projects = read(&state.storage, musetric_db::Reader::projects).await?;
    let mut items = Vec::with_capacity(projects.len());
    for project in &projects {
        items.push(build_item(state, project).await?);
    }
    Ok(Value::Array(items))
}

async fn build_item(state: &RouteState, project: &ProjectItem) -> Result<Value, Failure> {
    let project_id = project.id;
    let gains = read(&state.storage, move |reader| {
        reader.audio_analysis(project_id)
    })
    .await?;
    let processing = state
        .queue
        .processing(project_id)
        .await
        .map_err(Failure::failed)?;
    let mut item = Map::new();
    item.insert("id".to_owned(), json!(project.id));
    item.insert("name".to_owned(), json!(project.name));
    item.insert("sampleRate".to_owned(), json!(project.sample_rate));
    item.insert("frameCount".to_owned(), json!(project.frame_count));
    if let Some(preview_id) = project.preview_id {
        item.insert(
            "previewUrl".to_owned(),
            json!(format!("/api/preview/{preview_id}")),
        );
    }
    if let Some(analysis) = gains {
        item.insert("audioAnalysis".to_owned(), build_analysis(&analysis));
    }
    item.insert("processing".to_owned(), build_processing(&processing));
    Ok(Value::Object(item))
}

fn build_analysis(analysis: &AudioAnalysis) -> Value {
    json!({
        "sourceGainDb": number(analysis.source_gain_db),
        "leadSpectrogramGainDb": number(analysis.lead_spectrogram_gain_db),
        "practiceGainsDb": {
            "lead": number(analysis.lead_gain_db),
            "backing": number(analysis.backing_gain_db),
            "instrumental": number(analysis.instrumental_gain_db),
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
    if let Some(progress) = step.progress {
        view.insert("progress".to_owned(), number(progress));
    }
    if let Some(download) = step.download.as_ref() {
        view.insert("download".to_owned(), download.clone());
    }
    if let Some(error) = step.error.as_ref() {
        view.insert("error".to_owned(), json!(error));
    }
    Value::Object(view)
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "the value is checked to be a whole number inside the safe integer range"
)]
fn number(value: f64) -> Value {
    const SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;
    if value.fract() == 0.0 && value.abs() <= SAFE_INTEGER {
        return json!(value as i64);
    }
    json!(value)
}
