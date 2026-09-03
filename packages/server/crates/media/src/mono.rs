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

#[cfg(test)]
mod tests {
    use super::{Downmix, decode_mono_pcm};
    use crate::{
        fixture::{Fixture, Partial, Signal, read_floats, worst_difference},
        pcm::PcmRequest,
    };

    const SOURCE_RATE: u32 = 48000;
    const MODEL_RATE: u32 = 22050;
    const SECONDS: f64 = 1.0;
    const TOLERANCE: f32 = 1e-6;
    const CORRELATION: f64 = 0.998;
    const LEVEL_TOLERANCE: f64 = 0.01;

    const LEFT: [Partial; 1] = [Partial {
        frequency: 440.0,
        amplitude: 0.6,
        phase: 0.0,
    }];
    const RIGHT: [Partial; 1] = [Partial {
        frequency: 523.25,
        amplitude: 0.3,
        phase: 1.0,
    }];

    fn tone(name: &'static str) -> Signal<'static> {
        Signal {
            name,
            seconds: SECONDS,
            sample_rate: SOURCE_RATE,
            left: &LEFT,
            right: &RIGHT,
            gate: None,
        }
    }

    async fn mono_by_crate(
        fixture: &Fixture,
        from: &std::path::Path,
        sample_rate: u32,
        downmix: Downmix,
    ) -> Vec<f32> {
        let request = PcmRequest { from, sample_rate };
        let bytes = decode_mono_pcm(&fixture.pcm, request, downmix)
            .await
            .expect("the source should be downmixed");
        read_floats(&bytes)
    }

    async fn golden(name: &str) -> Vec<f32> {
        read_floats(
            &tokio::fs::read(Fixture::asset(name))
                .await
                .expect("the golden pcm should exist"),
        )
    }

    #[tokio::test]
    async fn weighs_the_channels_the_way_the_reference_weighs_them() {
        let fixture = Fixture::create();
        let source = fixture.write_wav24(&tone("source.wav"));
        let mixed = mono_by_crate(&fixture, &source, SOURCE_RATE, Downmix::Power).await;
        compare_exact(&mixed, &golden("mono-power.pcm").await);
    }

    #[tokio::test]
    async fn averages_the_channels_the_way_the_browser_averages_them() {
        let fixture = Fixture::create();
        let source = fixture.write_wav24(&tone("source.wav"));
        let mixed = mono_by_crate(&fixture, &source, SOURCE_RATE, Downmix::Mean).await;
        compare_exact(&mixed, &golden("mono-mean.pcm").await);
    }

    #[tokio::test]
    async fn keeps_the_mix_when_the_model_asks_for_another_rate() {
        let fixture = Fixture::create();
        let source = fixture.write_wav24(&tone("source.wav"));
        let mixed = mono_by_crate(&fixture, &source, MODEL_RATE, Downmix::Mean).await;
        let expected = golden("mono-mean-22050.pcm").await;
        assert_eq!(mixed.len(), expected.len());
        let matched = crate::fixture::correlation(&mixed, &expected);
        assert!(matched > CORRELATION, "correlation {matched}");
        let gain = crate::fixture::level(&mixed, &expected);
        assert!((gain - 1.0).abs() < LEVEL_TOLERANCE, "level {gain}");
    }

    fn compare_exact(mixed: &[f32], expected: &[f32]) {
        assert_eq!(mixed.len(), expected.len());
        let worst = worst_difference(mixed, expected);
        assert!(worst < TOLERANCE, "worst sample difference {worst}");
    }
}
