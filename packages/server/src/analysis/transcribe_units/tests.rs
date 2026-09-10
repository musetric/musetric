#![allow(
    clippy::float_cmp,
    reason = "the unit protocol samples are reconstructed with deterministic floats"
)]
use std::sync::Arc;

use musetric_gpu::{ExecutorHost, UnitSession};
use reqwest::{Client, StatusCode};
use serde_json::{Value, json};
use tokio::time::{Duration, timeout};

use super::{
    ChunkRange, Plan, Restored, Span, StartPass, TranscribeState, TranscribeUnits, restore_state,
};
use crate::test_workspace::{Workspace, get_unit_window};

const ANSWER: Duration = Duration::from_secs(5);
const ATTEMPT: &str = "attempt-1";
const RATE: f64 = 16000.0;

#[allow(
    clippy::float_cmp,
    reason = "the input vector is constructed with deterministic floats"
)]
#[allow(
    clippy::cast_possible_truncation,
    reason = "the input vectors hold seconds markers within float range"
)]
fn input() -> Vec<f32> {
    (0..128_000)
        .map(|sample| f64::from(sample) / RATE)
        .map(|value| value as f32)
        .collect()
}

fn units_for(workspace: &Workspace, state: TranscribeState) -> Arc<TranscribeUnits> {
    Arc::new(TranscribeUnits::create(
        workspace.unit_incoming_path(),
        Arc::new(input()),
        16_000,
        state,
    ))
}

async fn start_host(workspace: &Workspace, units: Arc<TranscribeUnits>) -> ExecutorHost {
    workspace
        .start_unit_host("Fixture transcription", units as Arc<dyn UnitSession>)
        .await
}

async fn put_output(base: &str, attempt: &str, unit: u32, body: Value) -> StatusCode {
    Client::new()
        .put(format!("{base}/attempt/{attempt}/unit/{unit}/result"))
        .body(body.to_string())
        .send()
        .await
        .expect("the output should answer")
        .status()
}

fn container_parts(body: &[u8]) -> (Value, Vec<f32>) {
    let length = u32::from_le_bytes(body[0..4].try_into().expect("four bytes")) as usize;
    let meta = serde_json::from_slice(&body[4..4 + length]).expect("the meta should parse");
    let payload = body[4 + length..]
        .chunks_exact(4)
        .map(|raw| f32::from_le_bytes(raw.try_into().expect("four bytes")))
        .collect();
    (meta, payload)
}

fn plan_value(language: &str, packed: &Value) -> Value {
    json!({ "language": language, "packed": packed })
}

fn plain_packed() -> Value {
    json!([[[2.0, 5.0], [6.0, 8.0]]])
}

async fn fold_plan(base: &str, units: &TranscribeUnits) {
    let status = put_output(base, ATTEMPT, 0, plan_value("en", &plain_packed())).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    timeout(ANSWER, units.folded(0))
        .await
        .expect("the fold should not hang")
        .expect("the plan should fold");
}

#[tokio::test]
async fn serves_the_whole_audio_as_the_plan_window() {
    let workspace = Workspace::new();
    let units = units_for(&workspace, TranscribeState::default());
    units
        .register(ATTEMPT)
        .expect("the attempt should register");
    let host = start_host(&workspace, Arc::clone(&units)).await;
    let base = host.base_url().to_owned();

    let (status, body) = get_unit_window(&base, ATTEMPT, 0).await;
    assert_eq!(status, StatusCode::OK);
    let (meta, payload) = container_parts(&body);
    assert_eq!(meta, json!({ "kind": "plan" }));
    assert_eq!(payload.len(), 128_000);
    assert_eq!(payload[3_200], 0.2);
    host.close().await;
}

#[tokio::test]
async fn folds_a_plan_and_serves_the_chunk_window() {
    let workspace = Workspace::new();
    let units = units_for(&workspace, TranscribeState::default());
    units
        .register(ATTEMPT)
        .expect("the attempt should register");
    let host = start_host(&workspace, Arc::clone(&units)).await;
    let base = host.base_url().to_owned();

    let plan_status = put_output(&base, ATTEMPT, 0, plan_value("en", &plain_packed())).await;
    assert_eq!(plan_status, StatusCode::NO_CONTENT);
    timeout(ANSWER, units.folded(0))
        .await
        .expect("the fold should not hang")
        .expect("the plan should fold");

    let (status, body) = get_unit_window(&base, ATTEMPT, 1).await;
    assert_eq!(status, StatusCode::OK);
    let (meta, payload) = container_parts(&body);
    assert_eq!(meta, json!({ "kind": "chunk", "language": "en" }));
    assert_eq!(payload.len(), 112_000);
    assert_eq!(payload[0], 2.0);
    assert_eq!(payload[47_999], 4.999_937_5);
    assert_eq!(payload[48_000], 0.0);
    assert_eq!(payload[80_000], 6.0);
    host.close().await;
}

#[tokio::test]
async fn refuses_a_plan_whose_packing_is_inconsistent() {
    let workspace = Workspace::new();
    let units = units_for(&workspace, TranscribeState::default());
    units
        .register(ATTEMPT)
        .expect("the attempt should register");
    let host = start_host(&workspace, Arc::clone(&units)).await;
    let base = host.base_url().to_owned();

    let inconsistent = json!([[[2.0, 5.0]], [[6.0, 8.0]]]);
    let inconsistent_status = put_output(&base, ATTEMPT, 0, plan_value("en", &inconsistent)).await;
    assert_eq!(inconsistent_status, StatusCode::INTERNAL_SERVER_ERROR);
    let waiting = units.folded(0);
    let pending = timeout(Duration::from_millis(100), waiting).await;
    assert!(pending.is_err(), "an inconsistent plan must not fold");

    let outside = json!([[[0.0, 9.0]]]);
    let outside_status = put_output(&base, ATTEMPT, 0, plan_value("en", &outside)).await;
    assert_eq!(outside_status, StatusCode::INTERNAL_SERVER_ERROR);
    host.close().await;
}

#[tokio::test]
async fn accepts_words_replacements_and_the_final_result() {
    let workspace = Workspace::new();
    let units = units_for(&workspace, TranscribeState::default());
    units
        .register(ATTEMPT)
        .expect("the attempt should register");
    let host = start_host(&workspace, Arc::clone(&units)).await;
    let base = host.base_url().to_owned();

    fold_plan(&base, &units).await;

    let chunk_words = json!({ "words": [{ "text": "hi", "start": 0.1, "end": 0.4 }] });
    let chunk_status = put_output(&base, ATTEMPT, 1, chunk_words).await;
    assert_eq!(chunk_status, StatusCode::NO_CONTENT);
    timeout(ANSWER, units.folded(1))
        .await
        .expect("the fold should not hang")
        .expect("the chunk should fold");

    units
        .set_pass(StartPass::Repair)
        .expect("the pass should switch");
    let repair = json!({ "replaced": [{ "index": 0, "words": [
        { "text": "rescued", "start": 0.2, "end": 0.9 }
    ] }] });
    let repair_status = put_output(&base, ATTEMPT, 0, repair).await;
    assert_eq!(repair_status, StatusCode::NO_CONTENT);
    timeout(ANSWER, units.folded(0))
        .await
        .expect("the fold should not hang")
        .expect("the repair should fold");

    let final_result = json!([{ "start": 0.2, "end": 0.9, "text": "rescued", "words": [] }]);
    let final_status = put_output(&base, ATTEMPT, 1, final_result.clone()).await;
    assert_eq!(final_status, StatusCode::NO_CONTENT);
    timeout(ANSWER, units.folded(1))
        .await
        .expect("the fold should not hang")
        .expect("the finalize should fold");

    let tail = units.tail().expect("the tail should serialize");
    let result = units.finalize().expect("the result should be present");
    assert_eq!(result, final_result);
    let restored = restore_state(&tail, &input(), 16_000).expect("the tail should restore");
    assert_eq!(restored.plan.as_ref().expect("the plan").language, "en");
    assert_eq!(restored.replaced.len(), 1);
    assert_eq!(restored.words[0][0].text, "hi");
    assert_eq!(restored.result, Some(final_result));
    host.close().await;
}

#[tokio::test]
async fn refuses_units_outside_the_pass_and_foreign_attempts() {
    let workspace = Workspace::new();
    let units = units_for(&workspace, TranscribeState::default());
    units
        .register(ATTEMPT)
        .expect("the attempt should register");
    let host = start_host(&workspace, Arc::clone(&units)).await;
    let base = host.base_url().to_owned();

    let (foreign, _) = get_unit_window(&base, "other", 0).await;
    assert_eq!(foreign, StatusCode::CONFLICT);
    let (early_chunk, _) = get_unit_window(&base, ATTEMPT, 1).await;
    assert_eq!(early_chunk, StatusCode::BAD_REQUEST);

    fold_plan(&base, &units).await;

    let (tail_unit, _) = get_unit_window(&base, ATTEMPT, 9).await;
    assert_eq!(tail_unit, StatusCode::BAD_REQUEST);
    host.close().await;
}

#[test]
fn restore_state_rejects_a_tail_for_other_audio() {
    let plan = Plan {
        language: "en".to_owned(),
        packed: vec![vec![Span(0.0, 2.0)]],
        chunks: vec![ChunkRange {
            from: 0,
            to: 32_000,
        }],
        compacted: vec![0.0; 32_000],
    };
    let state = TranscribeState {
        plan: Some(plan),
        words: vec![Vec::new()],
        replaced: Vec::new(),
        result: None,
    };
    let tail = serde_json::to_vec(&json!({
        "version": 2,
        "language": "en",
        "packed": [[[0.0, 2.0]]],
        "words": [[]],
        "replaced": [],
        "result": null,
    }))
    .expect("the tail should serialize");
    let restored = restore_state(&tail, &input(), 16_000).expect("the tail should restore");
    assert_eq!(restored.plan.as_ref().expect("the plan").language, "en");
    assert!(restored.result.is_none());

    let short: Vec<f32> = Vec::new();
    let mismatch = restore_state(&tail, &short, 16_000);
    assert!(
        mismatch.is_err(),
        "a tail for another audio must be refused"
    );

    let _ = state;
}

#[tokio::test]
async fn resumes_from_a_restored_state() {
    let workspace = Workspace::new();
    let tail = {
        let units = units_for(&workspace, TranscribeState::default());
        units
            .register(ATTEMPT)
            .expect("the attempt should register");
        let host = start_host(&workspace, Arc::clone(&units)).await;
        let base = host.base_url().to_owned();
        fold_plan(&base, &units).await;
        let tail = units.tail().expect("the tail should serialize");
        host.close().await;
        tail
    };
    let state = restore_state(&tail, &input(), 16_000).expect("the tail should restore");
    let restored = Some(Restored {
        state,
        pass: StartPass::Decode,
        next_unit: 1,
    });

    let units = units_for(
        &workspace,
        restored
            .as_ref()
            .map_or_else(TranscribeState::default, |found| found.state.clone()),
    );
    units
        .register(ATTEMPT)
        .expect("the attempt should register");
    let host = start_host(&workspace, Arc::clone(&units)).await;
    let base = host.base_url().to_owned();

    let waiting = units.folded(0);
    let pending = timeout(Duration::from_millis(100), waiting).await;
    assert!(
        pending.is_err(),
        "the plan unit should be skipped on resume"
    );

    let (status, body) = get_unit_window(&base, ATTEMPT, 1).await;
    assert_eq!(status, StatusCode::OK);
    let (meta, payload) = container_parts(&body);
    assert_eq!(meta, json!({ "kind": "chunk", "language": "en" }));
    assert_eq!(payload.len(), 112_000);
    host.close().await;
}
