use std::io::Write;

use crate::{
    BoxedError, CHANNELS, SAMPLE_BITS,
    dither::{Dither, SAMPLE_BYTES},
};

const PCM_FORMAT: u16 = 1;
const FORMAT_CHUNK_BYTES: u32 = 16;
const HEADER_TAIL_BYTES: u32 = 36;

pub struct WavWriter<W: Write> {
    writer: W,
    dither: Dither,
}

impl<W: Write> WavWriter<W> {
    pub fn create(mut writer: W, sample_rate: u32, frame_count: usize) -> Result<Self, BoxedError> {
        writer.write_all(&header(sample_rate, frame_count)?)?;
        Ok(Self {
            writer,
            dither: Dither::create(),
        })
    }

    pub fn push(&mut self, left: f32, right: f32) -> Result<(), BoxedError> {
        for value in [left, right] {
            self.writer
                .write_all(&self.dither.quantize(value).to_le_bytes())?;
        }
        Ok(())
    }

    pub fn finish(mut self) -> Result<W, BoxedError> {
        self.writer.flush()?;
        Ok(self.writer)
    }
}

fn header(sample_rate: u32, frame_count: usize) -> Result<Vec<u8>, BoxedError> {
    let channels = u16::try_from(CHANNELS)?;
    let block_align = u16::try_from(CHANNELS * SAMPLE_BYTES)?;
    let data_bytes = u32::try_from(frame_count * usize::from(block_align))?;
    let mut header = Vec::with_capacity(44);
    header.extend_from_slice(b"RIFF");
    header.extend_from_slice(&(HEADER_TAIL_BYTES + data_bytes).to_le_bytes());
    header.extend_from_slice(b"WAVEfmt ");
    header.extend_from_slice(&FORMAT_CHUNK_BYTES.to_le_bytes());
    header.extend_from_slice(&PCM_FORMAT.to_le_bytes());
    header.extend_from_slice(&channels.to_le_bytes());
    header.extend_from_slice(&sample_rate.to_le_bytes());
    header.extend_from_slice(&(sample_rate * u32::from(block_align)).to_le_bytes());
    header.extend_from_slice(&block_align.to_le_bytes());
    header.extend_from_slice(&u16::try_from(SAMPLE_BITS)?.to_le_bytes());
    header.extend_from_slice(b"data");
    header.extend_from_slice(&data_bytes.to_le_bytes());
    Ok(header)
}
