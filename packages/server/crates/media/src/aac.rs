use rusty_aac::Error;
use rusty_aac::encode::{AacEncoder as CodecEncoder, AacEncoderConfig};

use crate::BoxedError;

pub const FRAME_SAMPLES: u32 = 1024;

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
}

fn describe(failure: impl std::fmt::Display) -> BoxedError {
    failure.to_string().into()
}
