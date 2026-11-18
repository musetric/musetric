use crate::CHANNELS;

pub const WAVE_PEAK_COUNT: usize = 3840;

pub struct WavePeaks {
    peaks: Vec<f32>,
    segment_step: f64,
    last_segment: Option<usize>,
    frame_index: u64,
}

impl WavePeaks {
    #[expect(
        clippy::cast_precision_loss,
        reason = "the peaks are a Float32Array indexed by a floored segment, as in javascript"
    )]
    #[must_use]
    pub fn create(total_frames: u64) -> Self {
        Self {
            peaks: vec![0.0_f32; WAVE_PEAK_COUNT * 2],
            segment_step: total_frames as f64 / WAVE_PEAK_COUNT as f64,
            last_segment: None,
            frame_index: 0,
        }
    }

    #[expect(
        clippy::cast_precision_loss,
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "the peaks are a Float32Array indexed by a floored segment, as in javascript"
    )]
    pub fn push(&mut self, chunk: &[f32]) {
        let peak_count = WAVE_PEAK_COUNT as f64;
        for frame in chunk.as_chunks::<CHANNELS>().0 {
            let value = f64::midpoint(f64::from(frame[0]), f64::from(frame[1]));
            let segment = (self.frame_index as f64 / self.segment_step).floor();
            self.frame_index += 1;
            if segment.is_nan() || segment >= peak_count {
                continue;
            }
            let segment_index = segment as usize;
            let base = segment_index * 2;
            if self.last_segment != Some(segment_index) {
                self.peaks[base] = value as f32;
                self.peaks[base + 1] = value as f32;
                self.last_segment = Some(segment_index);
            }
            if value < f64::from(self.peaks[base]) {
                self.peaks[base] = value as f32;
            }
            if value > f64::from(self.peaks[base + 1]) {
                self.peaks[base + 1] = value as f32;
            }
        }
    }

    #[must_use]
    pub fn finish(self) -> Vec<f32> {
        self.peaks
    }
}
