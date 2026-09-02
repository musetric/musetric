use std::path::Path;

use tokio::fs::{create_dir_all, write};

use crate::{Tools, frames::read_frame_count, pcm::read_pcm, run::BoxedError};

pub const WAVE_PEAK_COUNT: usize = 3840;

pub async fn generate_wave_peaks(
    tools: &Tools,
    from: &Path,
    to: &Path,
    sample_rate: u32,
) -> Result<(), BoxedError> {
    if let Some(directory) = to.parent() {
        create_dir_all(directory).await?;
    }
    let total_frames = read_frame_count(tools, from, sample_rate).await?;
    let peaks = collect_peaks(tools, from, sample_rate, total_frames).await?;
    let mut bytes = Vec::with_capacity(peaks.len() * size_of::<f32>());
    for peak in peaks {
        bytes.extend_from_slice(&peak.to_le_bytes());
    }
    write(to, bytes).await?;
    Ok(())
}

#[expect(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "the peaks are a Float32Array indexed by a floored segment, as in javascript"
)]
async fn collect_peaks(
    tools: &Tools,
    from: &Path,
    sample_rate: u32,
    total_frames: u64,
) -> Result<Vec<f32>, BoxedError> {
    let peak_count = WAVE_PEAK_COUNT as f64;
    let segment_step = total_frames as f64 / peak_count;
    let mut peaks = vec![0.0_f32; WAVE_PEAK_COUNT * 2];
    let mut last_segment = None;
    read_pcm(tools, from, sample_rate, |left, right, frame_index| {
        let value = (f64::from(left) + f64::from(right)) * 0.5;
        let segment = (frame_index as f64 / segment_step).floor();
        if segment.is_nan() || segment >= peak_count {
            return;
        }
        let segment_index = segment as usize;
        let base = segment_index * 2;
        if last_segment != Some(segment_index) {
            peaks[base] = value as f32;
            peaks[base + 1] = value as f32;
            last_segment = Some(segment_index);
        }
        if value < f64::from(peaks[base]) {
            peaks[base] = value as f32;
        }
        if value > f64::from(peaks[base + 1]) {
            peaks[base + 1] = value as f32;
        }
    })
    .await?;
    Ok(peaks)
}
