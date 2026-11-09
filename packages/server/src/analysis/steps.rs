use std::path::Path;

use musetric_db::{Analysis, ProcessingStep};
use musetric_media::Downmix;
use serde_json::{Value, json};

use crate::analysis::{
    browser::{BrowserAnalysis, Failure, RequestInput, Serve},
    models::{BEAT_THIS, CHORD_NET, ModelPins, SKEY},
};

const VOICE_RANGE_SAMPLE_RATE: u32 = 48_000;

pub(crate) fn create(
    step: ProcessingStep,
    models_path: &Path,
    pins: &ModelPins,
) -> Option<BrowserAnalysis> {
    match step {
        ProcessingStep::Chords => Some(BrowserAnalysis {
            label: "Headless chords analysis",
            api: "musetricAiAnalyzeChords",
            stored: Analysis::Chords,
            sample_rate: pins.chords.model.sample_rate,
            downmix: CHORD_NET.downmix,
            require_shader_f16: false,
            files: CHORD_NET.cached(&pins.chords.model, models_path),
            serve: Serve::Files,
            build: build_chords,
        }),
        ProcessingStep::Rhythm => Some(BrowserAnalysis {
            label: "Headless rhythm analysis",
            api: "musetricAiAnalyzeRhythm",
            stored: Analysis::Rhythm,
            sample_rate: pins.rhythm.model.sample_rate,
            downmix: BEAT_THIS.downmix,
            require_shader_f16: false,
            files: BEAT_THIS.cached(&pins.rhythm.model, models_path),
            serve: Serve::Files,
            build: build_rhythm,
        }),
        ProcessingStep::Key => Some(BrowserAnalysis {
            label: "Headless key analysis",
            api: "musetricAiAnalyzeKey",
            stored: Analysis::Key,
            sample_rate: pins.key.model.sample_rate,
            downmix: SKEY.downmix,
            require_shader_f16: false,
            files: SKEY.cached(&pins.key.model, models_path),
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
        ProcessingStep::Separation | ProcessingStep::Transcription => None,
    }
}

fn build_chords(input: &RequestInput<'_>) -> Result<Value, Failure> {
    let pin = &input.pins.chords;
    Ok(json!({
        "attemptId": input.attempt_id,
        "attemptUrl": input.attempt_url,
        "outputs": ["result"],
        "modelUrl": input.url(&pin.model, "model")?,
        "planUrl": input.url(&pin.model, "plan")?,
        "planManifestUrl": input.url(&pin.model, "planManifest")?,
        "graph": pin.graph,
    }))
}

fn build_rhythm(input: &RequestInput<'_>) -> Result<Value, Failure> {
    let pin = &input.pins.rhythm;
    Ok(json!({
        "attemptId": input.attempt_id,
        "attemptUrl": input.attempt_url,
        "outputs": ["result"],
        "modelUrl": input.url(&pin.model, "model")?,
        "filterbankUrl": input.url(&pin.model, "filterbank")?,
        "graph": pin.graph,
    }))
}

fn build_key(input: &RequestInput<'_>) -> Result<Value, Failure> {
    let pin = &input.pins.key;
    Ok(json!({
        "attemptId": input.attempt_id,
        "attemptUrl": input.attempt_url,
        "outputs": ["result"],
        "modelUrl": input.url(&pin.model, "model")?,
        "graph": pin.graph,
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
