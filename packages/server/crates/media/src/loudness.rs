use std::path::Path;

use serde_json::Value;

use crate::{Tools, pcm::read_pcm, run::BoxedError, run::run};

const EPSILON: f64 = 1e-12;
const WINDOW_SECONDS: f64 = 0.1;
const HOP_SECONDS: f64 = 0.025;
const MINIMUM_ACTIVE_PEAK_DB: f64 = -55.0;
const MINIMUM_ACTIVE_DB: f64 = -70.0;
const ACTIVE_MARGIN_DB: f64 = 20.0;
const PERCENTILE: f64 = 0.95;

#[derive(Clone, Copy)]
pub struct Loudness {
    pub integrated_loudness_db: f64,
    pub true_peak_db: f64,
}

pub struct LeadVisualLoudness {
    pub loudness: Loudness,
    pub p95_rms_db: f64,
}

pub async fn analyze_loudness(tools: &Tools, from: &Path) -> Result<Loudness, BoxedError> {
    let arguments = vec![
        "-hide_banner".to_owned(),
        "-nostats".to_owned(),
        "-i".to_owned(),
        from.display().to_string(),
        "-map".to_owned(),
        "0:a:0".to_owned(),
        "-sn".to_owned(),
        "-dn".to_owned(),
        "-vn".to_owned(),
        "-af".to_owned(),
        "loudnorm=print_format=json".to_owned(),
        "-f".to_owned(),
        "null".to_owned(),
        "-".to_owned(),
    ];
    let finished = run(&tools.ffmpeg, &arguments).await?;
    parse_loudnorm(&finished.stderr)
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "javascript keeps this window in a Float32Array"
)]
pub async fn analyze_lead_visual_loudness(
    tools: &Tools,
    from: &Path,
    sample_rate: u32,
) -> Result<LeadVisualLoudness, BoxedError> {
    let loudness = analyze_loudness(tools, from).await?;
    let window_frames = frame_count(WINDOW_SECONDS, sample_rate);
    let hop_frames = frame_count(HOP_SECONDS, sample_rate) as u64;
    let active_threshold_db =
        MINIMUM_ACTIVE_DB.max(loudness.integrated_loudness_db - ACTIVE_MARGIN_DB);
    let mut window = vec![0.0_f32; window_frames];
    let mut active_rms_values = Vec::new();
    let mut write_index = 0_usize;
    let mut filled_frames = 0_usize;
    let mut next_window_start = 0_u64;

    read_pcm(tools, from, sample_rate, |left, right, frame_index| {
        window[write_index] = ((f64::from(left) + f64::from(right)) * 0.5) as f32;
        write_index = (write_index + 1) % window_frames;
        filled_frames = filled_frames.saturating_add(1).min(window_frames);
        let window_end = next_window_start + window_frames as u64 - 1;
        if filled_frames == window_frames && frame_index >= window_end {
            if let Some(rms_db) = measure_window(&window, write_index, active_threshold_db) {
                active_rms_values.push(rms_db);
            }
            next_window_start += hop_frames;
        }
    })
    .await?;

    Ok(LeadVisualLoudness {
        p95_rms_db: percentile(&mut active_rms_values, PERCENTILE)
            .unwrap_or(loudness.integrated_loudness_db),
        loudness,
    })
}

#[expect(
    clippy::cast_precision_loss,
    reason = "a window holds a fraction of a second of frames"
)]
fn measure_window(window: &[f32], write_index: usize, active_threshold_db: f64) -> Option<f64> {
    let frame_count = window.len();
    let mut sum_squares = 0.0_f64;
    let mut peak = 0.0_f64;
    for offset in 0..frame_count {
        let value = f64::from(window[(write_index + offset) % frame_count]);
        sum_squares += value * value;
        peak = peak.max(value.abs());
    }
    let rms_db = amplitude_to_db((sum_squares / frame_count as f64).sqrt());
    let peak_db = amplitude_to_db(peak);
    (rms_db >= active_threshold_db && peak_db >= MINIMUM_ACTIVE_PEAK_DB).then_some(rms_db)
}

fn amplitude_to_db(value: f64) -> f64 {
    20.0 * (value + EPSILON).log10()
}

#[expect(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "the index is picked the way Math.ceil picks it"
)]
fn percentile(values: &mut [f64], ratio: f64) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    values.sort_by(f64::total_cmp);
    let position = (values.len() as f64 * ratio).ceil() - 1.0;
    let index = (position.max(0.0) as usize).min(values.len() - 1);
    values.get(index).copied()
}

#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "the window length is a rounded count of frames"
)]
fn frame_count(seconds: f64, sample_rate: u32) -> usize {
    let frames = (seconds * f64::from(sample_rate)).round();
    frames.max(1.0) as usize
}

fn parse_loudnorm(reported: &str) -> Result<Loudness, BoxedError> {
    let start = reported
        .find('{')
        .ok_or("ffmpeg loudnorm output is missing JSON")?;
    let end = reported
        .rfind('}')
        .filter(|end| *end > start)
        .ok_or("ffmpeg loudnorm output is missing JSON")?;
    let parsed: Value = serde_json::from_str(&reported[start..=end])
        .map_err(|_| "ffmpeg loudnorm JSON is invalid")?;
    Ok(Loudness {
        integrated_loudness_db: read_measurement(&parsed, "input_i")?,
        true_peak_db: read_measurement(&parsed, "input_tp")?,
    })
}

fn read_measurement(parsed: &Value, label: &str) -> Result<f64, BoxedError> {
    let measured = match parsed.get(label) {
        Some(Value::Number(number)) => number.as_f64(),
        Some(Value::String(text)) => text.trim().parse::<f64>().ok(),
        _ => None,
    };
    measured
        .filter(|value| value.is_finite())
        .ok_or_else(|| format!("Invalid loudness {label}").into())
}
