use std::io::Write;

use rusty_mp3::{Error, Mp3Encoder as CodecEncoder, Mp3EncoderConfig};

use crate::{BoxedError, CHANNELS};

const KILOBIT: u32 = 1000;

pub struct Mp3Encoder {
    encoder: CodecEncoder,
    sample_rate: u32,
}

impl Mp3Encoder {
    #[must_use]
    pub fn create(sample_rate: u32, bitrate: u32) -> Self {
        Self {
            encoder: CodecEncoder::new(Mp3EncoderConfig {
                bitrate_kbps: bitrate / KILOBIT,
                vbr_quality: None,
            }),
            sample_rate,
        }
    }

    pub fn push(&mut self, samples: &[f32]) -> Result<(), BoxedError> {
        self.encoder
            .push_pcm_f32(samples, u16::try_from(CHANNELS)?, self.sample_rate)?;
        Ok(())
    }

    pub fn finish<W: Write>(mut self, mut writer: W) -> Result<W, BoxedError> {
        self.encoder.finish();
        loop {
            match self.encoder.next_packet() {
                Ok(packet) => writer.write_all(&packet)?,
                Err(Error::Eof) => break,
                Err(failure) => return Err(failure.into()),
            }
        }
        writer.flush()?;
        Ok(writer)
    }
}
