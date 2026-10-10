use std::path::Path;

use musetric_db::{Analysis, ProcessingStep};
use musetric_media::Downmix;
use serde_json::{Value, json};

use crate::analysis::{
    browser::{BrowserAnalysis, Failure, RequestInput, Serve},
    models::{
        BEAT_THIS, BEAT_THIS_FILTERBANK, BEAT_THIS_MODEL, CHORD_NET, CHORD_NET_MODEL,
        CHORD_NET_PLAN, CHORD_NET_PLAN_MANIFEST, SKEY, SKEY_MODEL, beat_this_graph,
        chord_net_graph, skey_graph,
    },
};

const VOICE_RANGE_SAMPLE_RATE: u32 = 48_000;

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
        ProcessingStep::VoiceRange => Some(BrowserAnalysis {
            label: "Headless voice range analysis",
            api: "musetricAiAnalyzeVoiceRange",
            stored: Analysis::VoiceRange,
            sample_rate: VOICE_RANGE_SAMPLE_RATE,
            downmix: Downmix::Mean,
            require_shader_f16: false,
            files: Vec::new(),
            serve: Serve::Files,
            build: build_voice_range,
        }),
        ProcessingStep::Separation | ProcessingStep::Voices | ProcessingStep::Transcription => None,
    }
}

fn build_chords(input: &RequestInput<'_>) -> Result<Value, Failure> {
    Ok(json!({
        "attemptId": input.attempt_id,
        "attemptUrl": input.attempt_url,
        "outputs": ["result"],
        "modelUrl": input.files.url(CHORD_NET_MODEL)?,
        "planUrl": input.files.url(CHORD_NET_PLAN)?,
        "planManifestUrl": input.files.url(CHORD_NET_PLAN_MANIFEST)?,
        "graph": chord_net_graph(),
    }))
}

fn build_rhythm(input: &RequestInput<'_>) -> Result<Value, Failure> {
    Ok(json!({
        "attemptId": input.attempt_id,
        "attemptUrl": input.attempt_url,
        "outputs": ["result"],
        "modelUrl": input.files.url(BEAT_THIS_MODEL)?,
        "filterbankUrl": input.files.url(BEAT_THIS_FILTERBANK)?,
        "graph": beat_this_graph(),
    }))
}

fn build_key(input: &RequestInput<'_>) -> Result<Value, Failure> {
    Ok(json!({
        "attemptId": input.attempt_id,
        "attemptUrl": input.attempt_url,
        "outputs": ["result"],
        "modelUrl": input.files.url(SKEY_MODEL)?,
        "graph": skey_graph(),
    }))
}

#[expect(
    clippy::unnecessary_wraps,
    reason = "every step builds its request through the same fallible signature"
)]
fn build_voice_range(input: &RequestInput<'_>) -> Result<Value, Failure> {
    Ok(json!({
        "attemptId": input.attempt_id,
        "attemptUrl": input.attempt_url,
        "outputs": ["result"],
    }))
}
