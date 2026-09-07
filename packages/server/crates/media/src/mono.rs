use std::f32::consts::FRAC_1_SQRT_2;

use crate::{
    BoxedError,
    pcm::{CHANNELS, DecodedFrames, PcmRequest, PcmSource},
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

pub struct MonoRequest<'mono> {
    pub source: &'mono dyn PcmSource,
    pub request: PcmRequest<'mono>,
    pub downmix: Downmix,
    pub decoded: DecodedFrames<'mono>,
}

pub async fn decode_mono_pcm(mono: MonoRequest<'_>) -> Result<Vec<u8>, BoxedError> {
    let mut collected = Vec::new();
    read_mono(mono, &mut collected).await?;
    if collected.is_empty() {
        return Err(NO_AUDIO.into());
    }
    Ok(collected)
}

async fn read_mono(mono: MonoRequest<'_>, collected: &mut Vec<u8>) -> Result<(), BoxedError> {
    let MonoRequest {
        source,
        request,
        downmix,
        decoded,
    } = mono;
    let weight = downmix.weight();
    let mut frames = 0_u64;
    let mut sink = |chunk: &[f32]| {
        for frame in chunk.chunks_exact(CHANNELS) {
            let value = (frame[0] + frame[1]) * weight;
            collected.extend_from_slice(&value.to_le_bytes());
            frames += 1;
        }
        decoded(frames);
    };
    source.read_pcm(request, &mut sink).await
}
