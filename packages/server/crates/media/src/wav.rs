use std::{
    fs::File,
    io::{BufWriter, Write},
    path::Path,
};

use crate::{BoxedError, SampleDepth, pcm::CHANNELS};

const WRITE_BUFFER_BYTE_LENGTH: usize = 256 * 1024;
const PCM_FORMAT: u16 = 1;
const FORMAT_CHUNK_BYTES: u32 = 16;
const HEADER_TAIL_BYTES: u32 = 36;

pub(crate) struct WavWriter {
    file: BufWriter<File>,
    depth: SampleDepth,
}

impl WavWriter {
    pub(crate) fn create(
        to: &Path,
        sample_rate: u32,
        depth: SampleDepth,
        frame_count: usize,
    ) -> Result<Self, BoxedError> {
        let mut file = BufWriter::with_capacity(WRITE_BUFFER_BYTE_LENGTH, File::create(to)?);
        file.write_all(&header(sample_rate, depth, frame_count)?)?;
        Ok(Self { file, depth })
    }

    pub(crate) fn push(&mut self, left: f32, right: f32) -> Result<(), BoxedError> {
        for value in [left, right] {
            let bytes = self.depth.quantize(value).to_le_bytes();
            self.file.write_all(&bytes[..self.depth.bytes()])?;
        }
        Ok(())
    }

    pub(crate) fn finish(mut self) -> Result<(), BoxedError> {
        self.file.flush()?;
        Ok(())
    }
}

fn header(sample_rate: u32, depth: SampleDepth, frame_count: usize) -> Result<Vec<u8>, BoxedError> {
    let channels = u16::try_from(CHANNELS)?;
    let block_align = u16::try_from(CHANNELS * depth.bytes())?;
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
    header.extend_from_slice(&u16::try_from(depth.bits())?.to_le_bytes());
    header.extend_from_slice(b"data");
    header.extend_from_slice(&data_bytes.to_le_bytes());
    Ok(header)
}
