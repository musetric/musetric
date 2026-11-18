use musetric_dsp::loudness::{LeadLoudnessMeter, LeadVisualLoudness, Loudness, LoudnessMeter};

use crate::{
    BoxedError,
    pcm::{PcmRequest, PcmSource},
};

pub async fn analyze_loudness(
    source: &dyn PcmSource,
    request: PcmRequest<'_>,
) -> Result<Loudness, BoxedError> {
    let mut meter = LoudnessMeter::create(request.sample_rate)?;
    source
        .read_pcm(request, &mut |chunk| meter.push(chunk))
        .await?;
    meter.finish()
}

pub async fn analyze_lead_visual_loudness(
    source: &dyn PcmSource,
    request: PcmRequest<'_>,
) -> Result<LeadVisualLoudness, BoxedError> {
    let mut meter = LeadLoudnessMeter::create(request.sample_rate)?;
    source
        .read_pcm(request, &mut |chunk| meter.push(chunk))
        .await?;
    meter.finish()
}
