use ebur128::{EbuR128, Mode};

use crate::{
    BoxedError,
    pcm::{CHANNELS, PcmRequest, PcmSource},
};

const EPSILON: f64 = 1e-12;
const FLUSH_FRAMES: usize = 4096;
const WINDOW_SECONDS: f64 = 0.1;
const HOP_SECONDS: f64 = 0.025;
const MINIMUM_ACTIVE_PEAK_DB: f64 = -55.0;
const MINIMUM_ACTIVE_DB: f64 = -70.0;
const ACTIVE_MARGIN_DB: f64 = 20.0;
const PERCENTILE: f64 = 0.95;
const ABSOLUTE_GATE_LUFS: f64 = -70.0;
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
        if !peak.is_finite() {
            return Err(SILENT_PEAK.into());
        }
        Ok(Loudness {
            integrated_loudness_db: integrated.max(ABSOLUTE_GATE_LUFS),
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
    use std::{f32::consts::TAU, path::Path};

    use super::{ABSOLUTE_GATE_LUFS, analyze_lead_visual_loudness, analyze_loudness};
    use crate::pcm::{PcmRequest, PcmSink, PcmSource, ReadingPcm};

    const SAMPLE_RATE: u32 = 48_000;
    const FRAMES: usize = 192_000;
    const CHANNELS: usize = 2;
    const FREQUENCY_HZ: f32 = 1000.0;
    const AMPLITUDE: f32 = 0.5;
    const SINE_PEAK_DB: f64 = -6.02;
    const SINE_INTEGRATED_LUFS: f64 = -6.1;
    const TOLERANCE_DB: f64 = 0.5;

    struct Samples(Vec<f32>);

    impl PcmSource for Samples {
        fn read_pcm<'source>(
            &'source self,
            _request: PcmRequest<'source>,
            sink: PcmSink<'source>,
        ) -> ReadingPcm<'source> {
            Box::pin(async move {
                sink(&self.0);
                Ok(())
            })
        }
    }

    fn request() -> PcmRequest<'static> {
        PcmRequest {
            from: Path::new("/unused"),
            sample_rate: SAMPLE_RATE,
        }
    }

    fn silence() -> Samples {
        Samples(vec![0.0; FRAMES * CHANNELS])
    }

    #[expect(
        clippy::cast_precision_loss,
        reason = "a frame index is far below the f32 precision"
    )]
    fn sine() -> Samples {
        Samples(
            (0..FRAMES)
                .map(|frame| {
                    AMPLITUDE * (TAU * FREQUENCY_HZ * frame as f32 / SAMPLE_RATE as f32).sin()
                })
                .flat_map(|value| [value, value])
                .collect(),
        )
    }

    #[tokio::test]
    async fn puts_silence_on_the_absolute_gate_instead_of_failing() {
        let loudness = analyze_loudness(&silence(), request())
            .await
            .expect("silence is a legal result");
        let lead = analyze_lead_visual_loudness(&silence(), request())
            .await
            .expect("silence is a legal result");

        let gated = [
            loudness.integrated_loudness_db,
            lead.loudness.integrated_loudness_db,
            lead.p95_rms_db,
        ];
        for value in gated {
            assert!(
                (value - ABSOLUTE_GATE_LUFS).abs() < 1e-9,
                "the value {value} should sit on the absolute gate"
            );
        }
        assert!(loudness.true_peak_db < ABSOLUTE_GATE_LUFS);
    }

    #[tokio::test]
    async fn keeps_measuring_audio_above_the_absolute_gate() {
        let loudness = analyze_loudness(&sine(), request())
            .await
            .expect("the loudness should be measured");

        assert!((loudness.true_peak_db - SINE_PEAK_DB).abs() < TOLERANCE_DB);
        assert!((loudness.integrated_loudness_db - SINE_INTEGRATED_LUFS).abs() < TOLERANCE_DB);
    }
}
