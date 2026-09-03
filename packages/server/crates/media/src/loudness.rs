use ebur128::{EbuR128, Mode};

use crate::{
    pcm::{CHANNELS, PcmRequest, PcmSource},
    run::BoxedError,
};

const EPSILON: f64 = 1e-12;
const FLUSH_FRAMES: usize = 4096;
const WINDOW_SECONDS: f64 = 0.1;
const HOP_SECONDS: f64 = 0.025;
const MINIMUM_ACTIVE_PEAK_DB: f64 = -55.0;
const MINIMUM_ACTIVE_DB: f64 = -70.0;
const ACTIVE_MARGIN_DB: f64 = 20.0;
const PERCENTILE: f64 = 0.95;
const SILENT_INTEGRATED: &str = "The integrated loudness is not a number";
const SILENT_PEAK: &str = "The true peak is not a number";

#[derive(Clone, Copy)]
pub struct Loudness {
    pub integrated_loudness_db: f64,
    pub true_peak_db: f64,
}

pub struct LeadVisualLoudness {
    pub loudness: Loudness,
    pub p95_rms_db: f64,
}

struct Meter {
    state: EbuR128,
    frames: Vec<f32>,
    failure: Option<ebur128::Error>,
}

impl Meter {
    fn create(sample_rate: u32) -> Result<Self, BoxedError> {
        let channels = u32::try_from(CHANNELS)?;
        let state = EbuR128::new(channels, sample_rate, Mode::I | Mode::TRUE_PEAK)?;
        Ok(Self {
            state,
            frames: Vec::with_capacity(FLUSH_FRAMES * CHANNELS),
            failure: None,
        })
    }

    fn push(&mut self, left: f32, right: f32) {
        self.frames.push(left);
        self.frames.push(right);
        if self.frames.len() >= FLUSH_FRAMES * CHANNELS {
            self.flush();
        }
    }

    fn flush(&mut self) {
        if self.failure.is_none()
            && let Err(failure) = self.state.add_frames_f32(&self.frames)
        {
            self.failure = Some(failure);
        }
        self.frames.clear();
    }

    fn finish(mut self) -> Result<Loudness, BoxedError> {
        self.flush();
        if let Some(failure) = self.failure {
            return Err(failure.into());
        }
        let integrated = self.state.loudness_global()?;
        let left = self.state.true_peak(0)?;
        let right = self.state.true_peak(1)?;
        let peak = amplitude_to_db(left.max(right));
        if !integrated.is_finite() {
            return Err(SILENT_INTEGRATED.into());
        }
        if !peak.is_finite() {
            return Err(SILENT_PEAK.into());
        }
        Ok(Loudness {
            integrated_loudness_db: integrated,
            true_peak_db: peak,
        })
    }
}

pub async fn analyze_loudness(
    source: &dyn PcmSource,
    request: PcmRequest<'_>,
) -> Result<Loudness, BoxedError> {
    let mut meter = Meter::create(request.sample_rate)?;
    measure(source, request, &mut meter).await?;
    meter.finish()
}

async fn measure(
    source: &dyn PcmSource,
    request: PcmRequest<'_>,
    meter: &mut Meter,
) -> Result<(), BoxedError> {
    let mut sink = |chunk: &[f32]| {
        for frame in chunk.chunks_exact(CHANNELS) {
            meter.push(frame[0], frame[1]);
        }
    };
    source.read_pcm(request, &mut sink).await
}

pub async fn analyze_lead_visual_loudness(
    source: &dyn PcmSource,
    request: PcmRequest<'_>,
) -> Result<LeadVisualLoudness, BoxedError> {
    let mut meter = Meter::create(request.sample_rate)?;
    let measured = measure_lead(source, request, &mut meter).await?;
    let loudness = meter.finish()?;
    let active_threshold_db =
        MINIMUM_ACTIVE_DB.max(loudness.integrated_loudness_db - ACTIVE_MARGIN_DB);
    let mut active_rms_values = measured
        .into_iter()
        .filter(|measurement| measurement.is_active(active_threshold_db))
        .map(|measurement| measurement.rms_db)
        .collect::<Vec<_>>();

    Ok(LeadVisualLoudness {
        p95_rms_db: percentile(&mut active_rms_values, PERCENTILE)
            .unwrap_or(loudness.integrated_loudness_db),
        loudness,
    })
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "javascript keeps this window in a Float32Array"
)]
async fn measure_lead(
    source: &dyn PcmSource,
    request: PcmRequest<'_>,
    meter: &mut Meter,
) -> Result<Vec<Window>, BoxedError> {
    let window_frames = frame_count(WINDOW_SECONDS, request.sample_rate);
    let hop_frames = frame_count(HOP_SECONDS, request.sample_rate) as u64;
    let mut window = vec![0.0_f32; window_frames];
    let mut measured = Vec::new();
    let mut write_index = 0_usize;
    let mut filled_frames = 0_usize;
    let mut next_window_start = 0_u64;
    let mut frame_index = 0_u64;
    let mut sink = |chunk: &[f32]| {
        for frame in chunk.chunks_exact(CHANNELS) {
            meter.push(frame[0], frame[1]);
            window[write_index] = ((f64::from(frame[0]) + f64::from(frame[1])) * 0.5) as f32;
            write_index = (write_index + 1) % window_frames;
            filled_frames = filled_frames.saturating_add(1).min(window_frames);
            let window_end = next_window_start + window_frames as u64 - 1;
            if filled_frames == window_frames && frame_index >= window_end {
                measured.push(measure_window(&window, write_index));
                next_window_start += hop_frames;
            }
            frame_index += 1;
        }
    };
    source.read_pcm(request, &mut sink).await?;
    Ok(measured)
}

struct Window {
    rms_db: f64,
    peak_db: f64,
}

impl Window {
    fn is_active(&self, active_threshold_db: f64) -> bool {
        self.rms_db >= active_threshold_db && self.peak_db >= MINIMUM_ACTIVE_PEAK_DB
    }
}

#[expect(
    clippy::cast_precision_loss,
    reason = "a window holds a fraction of a second of frames"
)]
fn measure_window(window: &[f32], write_index: usize) -> Window {
    let frame_count = window.len();
    let mut sum_squares = 0.0_f64;
    let mut peak = 0.0_f64;
    for offset in 0..frame_count {
        let value = f64::from(window[(write_index + offset) % frame_count]);
        sum_squares += value * value;
        peak = peak.max(value.abs());
    }
    Window {
        rms_db: amplitude_to_db((sum_squares / frame_count as f64).sqrt()),
        peak_db: amplitude_to_db(peak),
    }
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
    let index = ((values.len() as f64) * ratio).ceil() as usize;
    let clamped = index.saturating_sub(1).min(values.len() - 1);
    values.get(clamped).copied()
}

#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "a window is a fraction of a second at an audio sample rate"
)]
fn frame_count(seconds: f64, sample_rate: u32) -> usize {
    (seconds * f64::from(sample_rate)).round() as usize
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{analyze_lead_visual_loudness, analyze_loudness};
    use crate::{
        fixture::{Fixture, Signal},
        pcm::PcmRequest,
    };

    const SAMPLE_RATE: u32 = 48000;
    const TOLERANCE_DB: f64 = 0.1;
    const TONE: &str = "0.6*sin(440*2*PI*t)*(0.2+0.8*abs(sin(1.3*t)))|0.45*sin(523.25*2*PI*t+sin(3*t))*(0.1+0.9*abs(sin(0.7*t)))";

    async fn measured_by_ffmpeg(fixture: &Fixture, from: &Path) -> (f64, f64) {
        let arguments = vec![
            "-hide_banner".to_owned(),
            "-nostats".to_owned(),
            "-i".to_owned(),
            from.display().to_string(),
            "-af".to_owned(),
            "ebur128=peak=true".to_owned(),
            "-f".to_owned(),
            "null".to_owned(),
            "-".to_owned(),
        ];
        let output = tokio::process::Command::new(&fixture.tools.ffmpeg)
            .args(arguments)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output()
            .await
            .expect("ffmpeg should run");
        let reported = String::from_utf8_lossy(&output.stderr).into_owned();
        let summary = reported
            .rfind("Integrated loudness:")
            .map(|start| reported[start..].to_owned())
            .expect("the filter should print a summary");
        (
            read_labelled(&summary, "I:"),
            read_labelled(&summary, "Peak:"),
        )
    }

    fn read_labelled(summary: &str, label: &str) -> f64 {
        summary
            .lines()
            .filter_map(|line| line.trim().strip_prefix(label))
            .filter_map(|value| value.split_whitespace().next())
            .find_map(|value| value.parse::<f64>().ok())
            .expect("the summary should carry the measurement")
    }

    fn read_at(from: &Path) -> PcmRequest<'_> {
        PcmRequest {
            from,
            sample_rate: SAMPLE_RATE,
        }
    }

    fn tone(name: &str) -> Signal<'_> {
        Signal {
            name,
            expression: TONE,
            seconds: 4.0,
            sample_rate: SAMPLE_RATE,
        }
    }

    #[tokio::test]
    async fn measures_what_the_ffmpeg_filter_measures() {
        let fixture = Fixture::create();
        let source = fixture.write_wav(&tone("source.wav")).await;

        let measured = analyze_loudness(&fixture.pcm, read_at(&source))
            .await
            .expect("the loudness should be measured");
        let (integrated, true_peak) = measured_by_ffmpeg(&fixture, &source).await;

        assert!(
            (measured.integrated_loudness_db - integrated).abs() < TOLERANCE_DB,
            "integrated: rust {} ffmpeg {integrated}",
            measured.integrated_loudness_db
        );
        assert!(
            (measured.true_peak_db - true_peak).abs() < TOLERANCE_DB,
            "true peak: rust {} ffmpeg {true_peak}",
            measured.true_peak_db
        );
    }

    #[tokio::test]
    async fn reads_the_lead_window_in_the_same_pass() {
        let fixture = Fixture::create();
        let source = fixture.write_wav(&tone("source.wav")).await;

        let visual = analyze_lead_visual_loudness(&fixture.pcm, read_at(&source))
            .await
            .expect("the lead loudness should be measured");
        let alone = analyze_loudness(&fixture.pcm, read_at(&source))
            .await
            .expect("the loudness should be measured");

        assert!(
            (visual.loudness.integrated_loudness_db - alone.integrated_loudness_db).abs() < 1e-9
        );
        assert!(visual.p95_rms_db > visual.loudness.integrated_loudness_db - 20.0);
    }
}
