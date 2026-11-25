use ebur128::{EbuR128, Mode};

use crate::{BoxedError, CHANNELS};

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

pub struct LoudnessMeter {
    state: EbuR128,
    frames: Vec<f32>,
    failure: Option<ebur128::Error>,
}

impl LoudnessMeter {
    pub fn create(sample_rate: u32) -> Result<Self, BoxedError> {
        let channels = u32::try_from(CHANNELS)?;
        let state = EbuR128::new(channels, sample_rate, Mode::I | Mode::TRUE_PEAK)?;
        Ok(Self {
            state,
            frames: Vec::with_capacity(FLUSH_FRAMES * CHANNELS),
            failure: None,
        })
    }

    pub fn push(&mut self, chunk: &[f32]) {
        for frame in chunk.as_chunks::<CHANNELS>().0 {
            self.push_frame(frame[0], frame[1]);
        }
    }

    fn push_frame(&mut self, left: f32, right: f32) {
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

    pub fn finish(mut self) -> Result<Loudness, BoxedError> {
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

pub struct LeadLoudnessMeter {
    meter: LoudnessMeter,
    window: Vec<f32>,
    window_frames: usize,
    hop_frames: u64,
    measured: Vec<Window>,
    write_index: usize,
    filled_frames: usize,
    next_window_start: u64,
    frame_index: u64,
}

impl LeadLoudnessMeter {
    pub fn create(sample_rate: u32) -> Result<Self, BoxedError> {
        let window_frames = frame_count(WINDOW_SECONDS, sample_rate);
        Ok(Self {
            meter: LoudnessMeter::create(sample_rate)?,
            window: vec![0.0_f32; window_frames],
            window_frames,
            hop_frames: frame_count(HOP_SECONDS, sample_rate) as u64,
            measured: Vec::new(),
            write_index: 0,
            filled_frames: 0,
            next_window_start: 0,
            frame_index: 0,
        })
    }

    #[expect(
        clippy::cast_possible_truncation,
        reason = "javascript keeps this window in a Float32Array"
    )]
    pub fn push(&mut self, chunk: &[f32]) {
        for frame in chunk.as_chunks::<CHANNELS>().0 {
            self.meter.push_frame(frame[0], frame[1]);
            self.window[self.write_index] =
                f64::midpoint(f64::from(frame[0]), f64::from(frame[1])) as f32;
            self.write_index = (self.write_index + 1) % self.window_frames;
            self.filled_frames = self.filled_frames.saturating_add(1).min(self.window_frames);
            let window_end = self.next_window_start + self.window_frames as u64 - 1;
            if self.filled_frames == self.window_frames && self.frame_index >= window_end {
                self.measured
                    .push(measure_window(&self.window, self.write_index));
                self.next_window_start += self.hop_frames;
            }
            self.frame_index += 1;
        }
    }

    pub fn finish(self) -> Result<LeadVisualLoudness, BoxedError> {
        let loudness = self.meter.finish()?;
        let active_threshold_db =
            MINIMUM_ACTIVE_DB.max(loudness.integrated_loudness_db - ACTIVE_MARGIN_DB);
        let mut active_rms_values = self
            .measured
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
