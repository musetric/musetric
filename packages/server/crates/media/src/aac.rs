use rusty_aac::encode::{
    AacEncoder as CodecEncoder, AacEncoderConfig, EncodedPacket, write_adts_header,
};
use rusty_aac::{AdtsHeader, Error};

use crate::run::BoxedError;

const LC_OBJECT_TYPE: u8 = 2;
const ADTS_HEADER_BYTES: usize = 7;

pub struct AacEncoder {
    encoder: CodecEncoder,
    sample_rate: u32,
    channels: u16,
    finished: bool,
}

impl AacEncoder {
    pub fn create(sample_rate: u32, channels: u8, bitrate: u32) -> Result<Self, BoxedError> {
        let config = AacEncoderConfig {
            bitrate_bps: bitrate,
            ..AacEncoderConfig::default()
        };
        Ok(Self {
            encoder: CodecEncoder::new(config),
            sample_rate,
            channels: u16::from(channels),
            finished: false,
        })
    }

    pub fn push(&mut self, samples: &[f32]) -> Result<(), BoxedError> {
        self.encoder
            .push_pcm(samples, self.channels, self.sample_rate)
            .map_err(describe)
    }

    pub fn finish(&mut self) -> Result<Vec<Vec<u8>>, BoxedError> {
        if !self.finished {
            self.encoder.finish();
            self.finished = true;
        }
        let mut frames = Vec::new();
        loop {
            match self.encoder.next_packet() {
                Ok(packet) => frames.push(self.wrap(&packet)),
                Err(Error::Eof | Error::Again) => break,
                Err(failure) => return Err(describe(failure)),
            }
        }
        Ok(frames)
    }

    fn wrap(&self, packet: &EncodedPacket) -> Vec<u8> {
        let header = AdtsHeader {
            object_type: LC_OBJECT_TYPE,
            sample_rate: self.sample_rate,
            channels: self.channels,
            frame_length: packet.data.len() + ADTS_HEADER_BYTES,
            header_len: ADTS_HEADER_BYTES,
        };
        let mut frame = write_adts_header(&header);
        frame.extend_from_slice(&packet.data);
        frame
    }
}

fn describe(failure: impl std::fmt::Display) -> BoxedError {
    failure.to_string().into()
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::AacEncoder;
    use crate::{
        fixture::{Fixture, Signal, correlation, level, read_floats},
        pcm::{CHANNELS, PcmRequest, collect_interleaved_pcm},
    };

    const RATE: u32 = 48_000;
    const SECONDS: f64 = 2.0;
    const BITRATE: u32 = 256_000;
    const TONE: &str =
        "0.6*sin(440*2*PI*t)*(0.2+0.8*abs(sin(1.3*t)))|0.45*sin(523.25*2*PI*t+sin(3*t))";
    const CHORD: &str = "0.5*sin(261.63*2*PI*t)+0.4*sin(329.63*2*PI*t+1)+0.3*sin(392*2*PI*t+2)+0.2*sin(523.25*2*PI*t+3)+0.15*sin(659.26*2*PI*t+4)+0.1*sin(783.99*2*PI*t+5)";
    const BURSTS: &str =
        "'0.9*sin(2000*2*PI*t)*lt(mod(t,0.5),0.05)+0.4*sin(300*2*PI*t)*(1-lt(mod(t,0.5),0.05))'";
    const FRAME_SAMPLES: usize = 1024;
    const FIDELITY_MARGIN: f64 = 0.002;
    const LEVEL_TOLERANCE: f64 = 0.015;
    const BUDGET_LOW: f64 = 0.9;
    const BUDGET_HIGH: f64 = 1.05;

    fn signal<'signal>(name: &'signal str, expression: &'signal str) -> Signal<'signal> {
        Signal {
            name,
            expression,
            seconds: SECONDS,
            sample_rate: RATE,
        }
    }

    async fn read_pcm(fixture: &Fixture, from: &Path) -> Vec<f32> {
        let request = PcmRequest {
            from,
            sample_rate: RATE,
        };
        let bytes = collect_interleaved_pcm(&fixture.pcm, request)
            .await
            .expect("the decoder should read the file");
        read_floats(&bytes)
    }

    fn encoded_stream(source: &[f32]) -> Vec<u8> {
        let channels = u8::try_from(CHANNELS).expect("the channel count fits");
        let mut encoder =
            AacEncoder::create(RATE, channels, BITRATE).expect("the encoder should be built");
        for chunk in source.chunks(4096) {
            encoder.push(chunk).expect("the hop should be buffered");
        }
        let mut stream = Vec::new();
        for frame in encoder.finish().expect("the stream should be encoded") {
            stream.extend_from_slice(&frame);
        }
        stream
    }
    async fn compare(fixture: &Fixture, name: &str, expression: &str) {
        let source = fixture.write_wav(&signal(name, expression)).await;
        let original = read_pcm(fixture, &source).await;

        let stream = encoded_stream(&original);
        let ours = fixture.join("ours.aac");
        tokio::fs::write(&ours, &stream)
            .await
            .expect("the encoded stream should be stored");
        let ours_pcm = read_pcm(fixture, &ours).await;

        let theirs = fixture
            .write_as(
                &signal("theirs.m4a", expression),
                &["-c:a", "aac", "-profile:a", "aac_low", "-b:a", "256k"],
            )
            .await;
        let theirs_pcm = read_pcm(fixture, &theirs).await;

        let hop = FRAME_SAMPLES * CHANNELS;
        let frames = original.len().div_ceil(hop) + 1;
        assert_eq!(ours_pcm.len(), frames * hop);
        assert_eq!(theirs_pcm.len().div_ceil(hop), frames);

        let window = hop + original.len();
        let ours_body = &ours_pcm[hop..window];
        let theirs_body = &theirs_pcm[hop..window];
        let ours_fidelity = correlation(ours_body, &original);
        let theirs_fidelity = correlation(theirs_body, &original);
        assert!(
            ours_fidelity > theirs_fidelity - FIDELITY_MARGIN,
            "fidelity {ours_fidelity} against {theirs_fidelity}"
        );
        let gain = level(ours_body, &original);
        assert!((gain - 1.0).abs() < LEVEL_TOLERANCE, "level {gain}");

        let seconds = f64::from(u32::try_from(original.len() / CHANNELS).expect("the length fits"))
            / f64::from(RATE);
        let bits = f64::from(u32::try_from(stream.len()).expect("the stream fits")) * 8.0;
        let spent = bits / seconds;
        assert!(
            spent > f64::from(BITRATE) * BUDGET_LOW && spent < f64::from(BITRATE) * BUDGET_HIGH,
            "bitrate {spent}"
        );
    }

    #[tokio::test]
    async fn matches_the_ffmpeg_encoder_on_the_tone() {
        let fixture = Fixture::create();
        compare(&fixture, "tone.wav", TONE).await;
    }

    #[tokio::test]
    async fn matches_the_ffmpeg_encoder_on_the_chord() {
        let fixture = Fixture::create();
        compare(&fixture, "chord.wav", CHORD).await;
    }

    #[tokio::test]
    async fn matches_the_ffmpeg_encoder_on_the_bursts() {
        let fixture = Fixture::create();
        compare(&fixture, "bursts.wav", BURSTS).await;
    }
}
