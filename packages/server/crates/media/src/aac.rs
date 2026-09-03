use rusty_aac::Error;
use rusty_aac::encode::{AacEncoder as CodecEncoder, AacEncoderConfig};
#[cfg(test)]
use rusty_aac::{AdtsHeader, encode::write_adts_header};

use crate::BoxedError;

pub const FRAME_SAMPLES: u32 = 1024;
#[cfg(test)]
const LC_OBJECT_TYPE: u8 = 2;
#[cfg(test)]
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
                Ok(packet) => frames.push(packet.data),
                Err(Error::Eof | Error::Again) => break,
                Err(failure) => return Err(describe(failure)),
            }
        }
        Ok(frames)
    }

    #[cfg(test)]
    pub(crate) fn adts(&self, raw: &[u8]) -> Vec<u8> {
        let header = AdtsHeader {
            object_type: LC_OBJECT_TYPE,
            sample_rate: self.sample_rate,
            channels: self.channels,
            frame_length: raw.len() + ADTS_HEADER_BYTES,
            header_len: ADTS_HEADER_BYTES,
        };
        let mut frame = write_adts_header(&header);
        frame.extend_from_slice(raw);
        frame
    }
}

fn describe(failure: impl std::fmt::Display) -> BoxedError {
    failure.to_string().into()
}

#[cfg(test)]
mod tests {
    use super::AacEncoder;
    use crate::{
        fixture::{Fixture, Partial, Signal, correlation, level, read_floats},
        pcm::{CHANNELS, PcmRequest, collect_interleaved_pcm},
    };

    const RATE: u32 = 48_000;
    const SECONDS: f64 = 2.0;
    const BITRATE: u32 = 256_000;
    const FRAME_SAMPLES: usize = 1024;
    const FIDELITY_MARGIN: f64 = 0.002;
    const LEVEL_TOLERANCE: f64 = 0.015;
    const BUDGET_LOW: f64 = 0.9;
    const BUDGET_HIGH: f64 = 1.05;

    fn signal<'signal>(
        name: &'signal str,
        left: &'signal [Partial],
        right: &'signal [Partial],
        gate: Option<&'signal (dyn Fn(f32) -> f32 + Sync)>,
    ) -> Signal<'signal> {
        Signal {
            name,
            seconds: SECONDS,
            sample_rate: RATE,
            left,
            right,
            gate,
        }
    }

    fn burst_gate(time: f32) -> f32 {
        if time % 0.5 < 0.05 { 1.0 } else { 0.4 }
    }

    async fn read_pcm(fixture: &Fixture, from: &std::path::Path) -> Vec<f32> {
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
        for raw in encoder.finish().expect("the stream should be encoded") {
            stream.extend_from_slice(&encoder.adts(&raw));
        }
        stream
    }

    async fn compare(fixture: &Fixture, golden: &str, source: Vec<f32>) {
        let stream = encoded_stream(&source);
        let ours = fixture.join("ours.aac");
        tokio::fs::write(&ours, &stream)
            .await
            .expect("the encoded stream should be stored");
        let ours_pcm = read_pcm(fixture, &ours).await;
        let theirs_pcm = read_pcm(fixture, &Fixture::asset(golden)).await;

        let hop = FRAME_SAMPLES * CHANNELS;
        let frames = source.len().div_ceil(hop) + 1;
        assert_eq!(ours_pcm.len(), frames * hop);
        assert_eq!(theirs_pcm.len().div_ceil(hop), frames);

        let window = hop + source.len();
        let ours_body = &ours_pcm[hop..window];
        let theirs_body = &theirs_pcm[hop..window];
        let ours_fidelity = correlation(ours_body, &source);
        let theirs_fidelity = correlation(theirs_body, &source);
        assert!(
            ours_fidelity > theirs_fidelity - FIDELITY_MARGIN,
            "fidelity {ours_fidelity} against {theirs_fidelity}"
        );
        let gain = level(ours_body, &source);
        assert!((gain - 1.0).abs() < LEVEL_TOLERANCE, "level {gain}");

        let seconds = f64::from(u32::try_from(source.len() / CHANNELS).expect("the length fits"))
            / f64::from(RATE);
        let bits = f64::from(u32::try_from(stream.len()).expect("the stream fits")) * 8.0;
        let spent = bits / seconds;
        assert!(
            spent > f64::from(BITRATE) * BUDGET_LOW && spent < f64::from(BITRATE) * BUDGET_HIGH,
            "bitrate {spent}"
        );
    }

    #[tokio::test]
    async fn matches_the_reference_encoder_on_the_tone() {
        const LEFT: [Partial; 2] = [
            Partial {
                frequency: 440.0,
                amplitude: 0.6,
                phase: 0.0,
            },
            Partial {
                frequency: 523.25,
                amplitude: 0.45,
                phase: 0.0,
            },
        ];
        const RIGHT: [Partial; 1] = [Partial {
            frequency: 587.33,
            amplitude: 0.4,
            phase: 1.0,
        }];
        let fixture = Fixture::create();
        compare(
            &fixture,
            "parity-tone.m4a",
            crate::fixture::render(&signal("tone", &LEFT, &RIGHT, None)),
        )
        .await;
    }

    #[tokio::test]
    async fn matches_the_reference_encoder_on_the_chord() {
        const CHORD: [Partial; 6] = [
            Partial {
                frequency: 261.63,
                amplitude: 0.5,
                phase: 0.0,
            },
            Partial {
                frequency: 329.63,
                amplitude: 0.4,
                phase: 1.0,
            },
            Partial {
                frequency: 392.0,
                amplitude: 0.3,
                phase: 2.0,
            },
            Partial {
                frequency: 523.25,
                amplitude: 0.2,
                phase: 3.0,
            },
            Partial {
                frequency: 659.26,
                amplitude: 0.15,
                phase: 4.0,
            },
            Partial {
                frequency: 783.99,
                amplitude: 0.1,
                phase: 5.0,
            },
        ];
        let fixture = Fixture::create();
        compare(
            &fixture,
            "parity-chord.m4a",
            crate::fixture::render(&signal("chord", &CHORD, &CHORD, None)),
        )
        .await;
    }

    #[tokio::test]
    async fn matches_the_reference_encoder_on_the_bursts() {
        const BURSTS: [Partial; 2] = [
            Partial {
                frequency: 2000.0,
                amplitude: 0.9,
                phase: 0.0,
            },
            Partial {
                frequency: 300.0,
                amplitude: 0.4,
                phase: 0.0,
            },
        ];
        let fixture = Fixture::create();
        compare(
            &fixture,
            "parity-bursts.m4a",
            crate::fixture::render(&signal(
                "bursts",
                &BURSTS,
                &BURSTS,
                Some(&(burst_gate as fn(f32) -> f32)),
            )),
        )
        .await;
    }
}
