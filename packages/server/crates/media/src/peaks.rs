use std::path::Path;

use musetric_dsp::peaks::WavePeaks as PeakTrace;
use tokio::fs::{create_dir_all, write};

use crate::{
    BoxedError,
    pcm::{PcmRequest, PcmSource},
};

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
    let mut trace = PeakTrace::create(request.total_frames);
    source
        .read_pcm(request.source, &mut |chunk| trace.push(chunk))
        .await?;
    let peaks = trace.finish();
    let mut bytes = Vec::with_capacity(peaks.len() * size_of::<f32>());
    for peak in peaks {
        bytes.extend_from_slice(&peak.to_le_bytes());
    }
    write(request.to, bytes).await?;
    Ok(())
}
