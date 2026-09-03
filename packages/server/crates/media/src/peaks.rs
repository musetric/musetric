use std::path::Path;

use tokio::fs::{create_dir_all, write};

use crate::{
    BoxedError,
    pcm::{CHANNELS, PcmRequest, PcmSource},
};

pub const WAVE_PEAK_COUNT: usize = 3840;

pub struct WavePeaks<'request> {
    pub source: PcmRequest<'request>,
    pub to: &'request Path,
    pub total_frames: u64,
}

pub async fn generate_wave_peaks(
    source: &dyn PcmSource,
    request: &WavePeaks<'_>,
) -> Result<(), BoxedError> {
    if let Some(directory) = request.to.parent() {
        create_dir_all(directory).await?;
    }
    let peaks = collect_peaks(source, request).await?;
    let mut bytes = Vec::with_capacity(peaks.len() * size_of::<f32>());
    for peak in peaks {
        bytes.extend_from_slice(&peak.to_le_bytes());
    }
    write(request.to, bytes).await?;
    Ok(())
}

#[expect(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "the peaks are a Float32Array indexed by a floored segment, as in javascript"
)]
async fn collect_peaks(
    source: &dyn PcmSource,
    request: &WavePeaks<'_>,
) -> Result<Vec<f32>, BoxedError> {
    let peak_count = WAVE_PEAK_COUNT as f64;
    let segment_step = request.total_frames as f64 / peak_count;
    let mut peaks = vec![0.0_f32; WAVE_PEAK_COUNT * 2];
    let mut last_segment = None;
    let mut frame_index = 0_u64;
    let mut sink = |chunk: &[f32]| {
        for frame in chunk.chunks_exact(CHANNELS) {
            let value = (f64::from(frame[0]) + f64::from(frame[1])) * 0.5;
            let segment = (frame_index as f64 / segment_step).floor();
            frame_index += 1;
            if segment.is_nan() || segment >= peak_count {
                continue;
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
        }
    };
    source.read_pcm(request.source, &mut sink).await?;
    Ok(peaks)
}
