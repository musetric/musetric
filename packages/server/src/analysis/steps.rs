use std::path::Path;

use musetric_db::{Analysis, ProcessingStep};
use serde_json::{Value, json};

use crate::analysis::{
    browser::{BrowserAnalysis, Failure, HostedModel, Serve},
    models::{
        BEAT_THIS, BEAT_THIS_FILTERBANK, BEAT_THIS_MODEL, CHORD_NET, CHORD_NET_MODEL,
        CHORD_NET_PLAN, CHORD_NET_PLAN_MANIFEST, SKEY, SKEY_MODEL, beat_this_graph,
        chord_net_graph, skey_graph,
    },
};

pub(crate) fn create(step: ProcessingStep, models_path: &Path) -> Option<BrowserAnalysis> {
    match step {
        ProcessingStep::Chords => Some(BrowserAnalysis {
            label: "Headless chords analysis",
            api: "musetricAiAnalyzeChords",
            stored: Analysis::Chords,
            sample_rate: CHORD_NET.sample_rate,
            downmix: CHORD_NET.downmix,
            require_shader_f16: false,
            files: CHORD_NET.cached(models_path),
            serve: Serve::Files,
            build: build_chords,
        }),
        ProcessingStep::Rhythm => Some(BrowserAnalysis {
            label: "Headless rhythm analysis",
            api: "musetricAiAnalyzeRhythm",
            stored: Analysis::Rhythm,
            sample_rate: BEAT_THIS.sample_rate,
            downmix: BEAT_THIS.downmix,
            require_shader_f16: false,
            files: BEAT_THIS.cached(models_path),
            serve: Serve::Files,
            build: build_rhythm,
        }),
        ProcessingStep::Key => Some(BrowserAnalysis {
            label: "Headless key analysis",
            api: "musetricAiAnalyzeKey",
            stored: Analysis::Key,
            sample_rate: SKEY.sample_rate,
            downmix: SKEY.downmix,
            require_shader_f16: false,
            files: SKEY.cached(models_path),
            serve: Serve::Files,
            build: build_key,
        }),
        ProcessingStep::Separation | ProcessingStep::Voices | ProcessingStep::Transcription => None,
    }
}

fn build_chords(
    attempt_id: &str,
    attempt_url: &str,
    files: &HostedModel,
) -> Result<Value, Failure> {
    Ok(json!({
        "attemptId": attempt_id,
        "attemptUrl": attempt_url,
        "outputs": ["result"],
        "modelUrl": files.url(CHORD_NET_MODEL)?,
        "planUrl": files.url(CHORD_NET_PLAN)?,
        "planManifestUrl": files.url(CHORD_NET_PLAN_MANIFEST)?,
        "graph": chord_net_graph(),
    }))
}

fn build_rhythm(
    attempt_id: &str,
    attempt_url: &str,
    files: &HostedModel,
) -> Result<Value, Failure> {
    Ok(json!({
        "attemptId": attempt_id,
        "attemptUrl": attempt_url,
        "outputs": ["result"],
        "modelUrl": files.url(BEAT_THIS_MODEL)?,
        "filterbankUrl": files.url(BEAT_THIS_FILTERBANK)?,
        "graph": beat_this_graph(),
    }))
}

fn build_key(attempt_id: &str, attempt_url: &str, files: &HostedModel) -> Result<Value, Failure> {
    Ok(json!({
        "attemptId": attempt_id,
        "attemptUrl": attempt_url,
        "outputs": ["result"],
        "modelUrl": files.url(SKEY_MODEL)?,
        "graph": skey_graph(),
    }))
}
