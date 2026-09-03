use std::{
    fmt::Display,
    fs::File,
    io::{BufWriter, Seek, SeekFrom, Write},
    path::Path,
};

use flacenc::{
    bitsink::ByteSink,
    component::{BitRepr, Stream},
    config::Encoder as Configuration,
    encode_fixed_size_frame,
    error::{Verified, Verify},
    source::{Context, Fill, FrameBuf},
};

use crate::{pcm::CHANNELS, run::BoxedError};

const BITS_PER_SAMPLE: usize = 24;
const BLOCK_FRAMES: usize = 4096;
const WRITE_BUFFER_BYTE_LENGTH: usize = 256 * 1024;
const SCALE: f32 = 8_388_608.0;
const HIGHEST: f32 = 8_388_607.0;
const HEADER_MOVED: &str = "The flac header changed length while the stream was written";

pub(crate) struct FlacWriter {
    configuration: Verified<Configuration>,
    stream: Stream,
    frames: FrameBuf,
    context: Context,
    file: BufWriter<File>,
    pending: Vec<i32>,
    header_byte_length: usize,
    smallest_frame: usize,
    largest_frame: usize,
    failure: Option<BoxedError>,
}

impl FlacWriter {
    pub(crate) fn create(to: &Path, sample_rate: u32) -> Result<Self, BoxedError> {
        let configuration = Configuration::default()
            .into_verified()
            .map_err(|(_, failure)| describe(failure))?;
        let mut stream = Stream::new(usize::try_from(sample_rate)?, CHANNELS, BITS_PER_SAMPLE)
            .map_err(describe)?;
        stream
            .stream_info_mut()
            .set_block_sizes(BLOCK_FRAMES, BLOCK_FRAMES)
            .map_err(describe)?;
        let header = write_header(&stream)?;
        let mut file = BufWriter::with_capacity(WRITE_BUFFER_BYTE_LENGTH, File::create(to)?);
        file.write_all(&header)?;
        Ok(Self {
            configuration,
            stream,
            frames: FrameBuf::with_size(CHANNELS, BLOCK_FRAMES).map_err(describe)?,
            context: Context::new(BITS_PER_SAMPLE, CHANNELS),
            file,
            pending: Vec::with_capacity(BLOCK_FRAMES * CHANNELS),
            header_byte_length: header.len(),
            smallest_frame: usize::MAX,
            largest_frame: 0,
            failure: None,
        })
    }

    pub(crate) fn push(&mut self, left: f32, right: f32) {
        self.pending.push(quantize(left));
        self.pending.push(quantize(right));
        if self.pending.len() >= BLOCK_FRAMES * CHANNELS {
            self.encode();
        }
    }

    fn encode(&mut self) {
        if self.failure.is_some() || self.pending.is_empty() {
            return;
        }
        if let Err(failure) = self.encode_block() {
            self.failure = Some(failure);
        }
        self.pending.clear();
    }

    fn encode_block(&mut self) -> Result<(), BoxedError> {
        (&mut self.frames, &mut self.context)
            .fill_interleaved(&self.pending)
            .map_err(describe)?;
        let number = self
            .context
            .current_frame_number()
            .ok_or("The flac writer lost the frame number")?;
        let frame = encode_fixed_size_frame(
            &self.configuration,
            &self.frames,
            number,
            self.stream.stream_info(),
        )
        .map_err(describe)?;
        let mut sink = ByteSink::new();
        frame.write(&mut sink).map_err(describe)?;
        let encoded = sink.as_slice();
        self.smallest_frame = self.smallest_frame.min(encoded.len());
        self.largest_frame = self.largest_frame.max(encoded.len());
        self.file.write_all(encoded)?;
        Ok(())
    }

    pub(crate) fn finish(mut self) -> Result<(), BoxedError> {
        self.encode();
        if let Some(failure) = self.failure {
            return Err(failure);
        }
        let total_frames = self.context.total_samples();
        let digest = self.context.md5_digest();
        let smallest = self.smallest_frame.min(self.largest_frame);
        let info = self.stream.stream_info_mut();
        info.set_total_samples(total_frames);
        info.set_md5_digest(&digest);
        info.set_frame_sizes(smallest, self.largest_frame)
            .map_err(describe)?;
        let header = write_header(&self.stream)?;
        if header.len() != self.header_byte_length {
            return Err(HEADER_MOVED.into());
        }
        let mut file = self.file.into_inner()?;
        file.seek(SeekFrom::Start(0))?;
        file.write_all(&header)?;
        file.flush()?;
        Ok(())
    }
}

fn write_header(stream: &Stream) -> Result<Vec<u8>, BoxedError> {
    let mut sink = ByteSink::new();
    stream.write(&mut sink).map_err(describe)?;
    Ok(sink.as_slice().to_vec())
}

fn describe(failure: impl Display) -> BoxedError {
    failure.to_string().into()
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "the value is clamped to the 24-bit range before it is truncated"
)]
fn quantize(value: f32) -> i32 {
    (value * SCALE).round().clamp(-SCALE, HIGHEST) as i32
}
