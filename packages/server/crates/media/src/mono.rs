use std::f32::consts::FRAC_1_SQRT_2;

use crate::{
    pcm::{CHANNELS, PcmRequest, PcmSource},
    run::BoxedError,
};

const NO_AUDIO: &str = "The decoder produced no audio data";
const MEAN_WEIGHT: f32 = 0.5;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Downmix {
    Ffmpeg,
    Mean,
}

impl Downmix {
    fn weight(self) -> f32 {
        match self {
            Self::Ffmpeg => FRAC_1_SQRT_2,
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
    use std::path::Path;

    use super::{Downmix, decode_mono_pcm};
    use crate::{
        fixture::{Fixture, Signal, correlation, level, read_floats, worst_difference},
        pcm::PcmRequest,
        run::run,
    };

    const SOURCE_RATE: u32 = 48000;
    const MODEL_RATE: u32 = 22050;
    const SECONDS: f64 = 2.0;
    const TONE: &str = "0.6*sin(440*2*PI*t)|0.3*sin(523.25*2*PI*t+1)";
    const TOLERANCE: f32 = 1e-6;
    const CORRELATION: f64 = 0.998;
    const LEVEL_TOLERANCE: f64 = 0.01;

    async fn mono_by_ffmpeg(
        fixture: &Fixture,
        from: &Path,
        sample_rate: u32,
        downmix: [&str; 2],
    ) -> Vec<f32> {
        let arguments = vec![
            "-hide_banner".to_owned(),
            "-loglevel".to_owned(),
            "error".to_owned(),
            "-i".to_owned(),
            from.display().to_string(),
            "-map".to_owned(),
            "0:a:0".to_owned(),
            downmix[0].to_owned(),
            downmix[1].to_owned(),
            "-ar".to_owned(),
            sample_rate.to_string(),
            "-f".to_owned(),
            "f32le".to_owned(),
            "-c:a".to_owned(),
            "pcm_f32le".to_owned(),
            "-".to_owned(),
        ];
        let bytes = run(&fixture.tools.ffmpeg, &arguments)
            .await
            .expect("ffmpeg should downmix the source");
        read_floats(&bytes)
    }

    async fn mono_by_crate(
        fixture: &Fixture,
        from: &Path,
        sample_rate: u32,
        downmix: Downmix,
    ) -> Vec<f32> {
        let request = PcmRequest { from, sample_rate };
        let bytes = decode_mono_pcm(&fixture.pcm, request, downmix)
            .await
            .expect("the source should be downmixed");
        read_floats(&bytes)
    }

    fn tone(name: &str) -> Signal<'_> {
        Signal {
            name,
            expression: TONE,
            seconds: SECONDS,
            sample_rate: SOURCE_RATE,
        }
    }

    #[tokio::test]
    async fn weighs_the_channels_the_way_ffmpeg_weighs_them() {
        let fixture = Fixture::create();
        let source = fixture.write_flac(&tone("source.flac")).await;

        let mixed = mono_by_crate(&fixture, &source, SOURCE_RATE, Downmix::Ffmpeg).await;
        let expected = mono_by_ffmpeg(&fixture, &source, SOURCE_RATE, ["-ac", "1"]).await;

        assert_eq!(mixed.len(), expected.len());
        let worst = worst_difference(&mixed, &expected);
        assert!(worst < TOLERANCE, "worst sample difference {worst}");
    }

    #[tokio::test]
    async fn averages_the_channels_the_way_the_browser_averages_them() {
        let fixture = Fixture::create();
        let source = fixture.write_flac(&tone("source.flac")).await;

        let mixed = mono_by_crate(&fixture, &source, SOURCE_RATE, Downmix::Mean).await;
        let expected = mono_by_ffmpeg(
            &fixture,
            &source,
            SOURCE_RATE,
            ["-af", "pan=mono|c0=0.5*c0+0.5*c1"],
        )
        .await;

        assert_eq!(mixed.len(), expected.len());
        let worst = worst_difference(&mixed, &expected);
        assert!(worst < TOLERANCE, "worst sample difference {worst}");
    }

    #[tokio::test]
    async fn keeps_the_mix_when_the_model_asks_for_another_rate() {
        let fixture = Fixture::create();
        let source = fixture.write_flac(&tone("source.flac")).await;

        let mixed = mono_by_crate(&fixture, &source, MODEL_RATE, Downmix::Mean).await;
        let expected = mono_by_ffmpeg(
            &fixture,
            &source,
            MODEL_RATE,
            ["-af", "pan=mono|c0=0.5*c0+0.5*c1"],
        )
        .await;

        assert_eq!(mixed.len(), expected.len());
        let matched = correlation(&mixed, &expected);
        assert!(matched > CORRELATION, "correlation {matched}");
        let gain = level(&mixed, &expected);
        assert!((gain - 1.0).abs() < LEVEL_TOLERANCE, "level {gain}");
    }
}
