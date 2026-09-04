use std::f32::consts::FRAC_1_SQRT_2;

use crate::{
    BoxedError,
    pcm::{CHANNELS, PcmRequest, PcmSource},
};

const NO_AUDIO: &str = "The decoder produced no audio data";
const MEAN_WEIGHT: f32 = 0.5;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Downmix {
    Power,
    Mean,
}

impl Downmix {
    fn weight(self) -> f32 {
        match self {
            Self::Power => FRAC_1_SQRT_2,
            Self::Mean => MEAN_WEIGHT,
        }
    }
}

pub async fn decode_mono_pcm(
    source: &dyn PcmSource,
    request: PcmRequest<'_>,
    downmix: Downmix,
) -> Result<Vec<u8>, BoxedError> {
    let mut collected = Vec::new();
    read_mono(source, request, downmix, &mut collected).await?;
    if collected.is_empty() {
        return Err(NO_AUDIO.into());
    }
    Ok(collected)
}

async fn read_mono(
    source: &dyn PcmSource,
    request: PcmRequest<'_>,
    downmix: Downmix,
    collected: &mut Vec<u8>,
) -> Result<(), BoxedError> {
    let weight = downmix.weight();
    let mut sink = |chunk: &[f32]| {
        for frame in chunk.chunks_exact(CHANNELS) {
            let value = (frame[0] + frame[1]) * weight;
            collected.extend_from_slice(&value.to_le_bytes());
        }
    };
    source.read_pcm(request, &mut sink).await
}
