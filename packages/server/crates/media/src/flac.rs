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

use crate::{BoxedError, pcm::CHANNELS};

const BITS_PER_SAMPLE: usize = 24;
const BLOCK_FRAMES: usize = 4096;
const WRITE_BUFFER_BYTE_LENGTH: usize = 256 * 1024;
const SCALE: f32 = 8_388_608.0;
const HIGHEST: f32 = 8_388_607.0;
const HEADER_MOVED: &str = "The flac header changed length while the stream was written";
const SEEK_SECONDS: u64 = 2;
const SEEK_POINTS: usize = 512;
const SEEK_POINT_BYTES: usize = 18;
const SEEK_PLACEHOLDER: u64 = u64::MAX;
const MAGIC: &[u8; 4] = b"fLaC";
const STREAM_INFO_BLOCK: u8 = 0;
const SEEK_TABLE_BLOCK: u8 = 3;
const STREAM_INFO_BYTES: u8 = 34;
const STREAM_INFO_USIZE: usize = 34;
const NOT_A_MARKER: &str = "The flac stream info should serialize into bytes";
const OVERFLOWED: &str = "The flac header value does not fit its field";

struct FramePosition {
    first_sample: u64,
    offset: u64,
    bytes: u16,
}

pub(crate) struct FlacWriter {
    configuration: Verified<Configuration>,
    stream: Stream,
    frames: FrameBuf,
    context: Context,
    file: BufWriter<File>,
    pending: Vec<i32>,
    frame_positions: Vec<FramePosition>,
    header_byte_length: usize,
    written_bytes: u64,
    sample_rate: u32,
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
        let header = write_header(&stream, &placeholder_seek_table(sample_rate)?)?;
        let mut file = BufWriter::with_capacity(WRITE_BUFFER_BYTE_LENGTH, File::create(to)?);
        file.write_all(&header)?;
        Ok(Self {
            configuration,
            stream,
            frames: FrameBuf::with_size(CHANNELS, BLOCK_FRAMES).map_err(describe)?,
            context: Context::new(BITS_PER_SAMPLE, CHANNELS),
            file,
            pending: Vec::with_capacity(BLOCK_FRAMES * CHANNELS),
            frame_positions: Vec::new(),
            header_byte_length: header.len(),
            written_bytes: 0,
            sample_rate,
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
        let frame_bytes = u64::try_from(BLOCK_FRAMES)?;
        self.frame_positions.push(FramePosition {
            first_sample: u64::try_from(number)? * frame_bytes,
            offset: self.header_byte_length as u64 + self.written_bytes,
            bytes: u16::try_from(encoded.len()).unwrap_or(0),
        });
        self.written_bytes += encoded.len() as u64;
        self.file.write_all(encoded)?;
        Ok(())
    }

    pub(crate) fn finish(mut self) -> Result<(), BoxedError> {
        self.encode();
        if let Some(failure) = self.failure {
            return Err(failure);
        }
        let total_samples = self.context.total_samples();
        let total_frames = u64::try_from(total_samples)?;
        let digest = self.context.md5_digest();
        let smallest = self.smallest_frame.min(self.largest_frame);
        let info = self.stream.stream_info_mut();
        info.set_total_samples(total_samples);
        info.set_md5_digest(&digest);
        info.set_frame_sizes(smallest, self.largest_frame)
            .map_err(describe)?;
        let table = seek_table(&self.frame_positions, total_frames, self.sample_rate)?;
        let header = write_header(&self.stream, &table)?;
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

fn write_header(stream: &Stream, seek_table: &[u8]) -> Result<Vec<u8>, BoxedError> {
    let mut info = ByteSink::new();
    stream
        .stream_info()
        .write(&mut info)
        .map_err(|_| NOT_A_MARKER)?;
    let info_bytes = info.as_slice();
    debug_assert_eq!(info_bytes.len(), STREAM_INFO_USIZE);
    let mut header = Vec::with_capacity(MAGIC.len() + 4 + STREAM_INFO_USIZE + 4 + seek_table.len());
    header.extend_from_slice(MAGIC);
    header.extend_from_slice(&[STREAM_INFO_BLOCK, 0, 0, STREAM_INFO_BYTES]);
    header.extend_from_slice(info_bytes);
    header.push(0x80 | SEEK_TABLE_BLOCK);
    let seek_length = u32::try_from(seek_table.len()).map_err(|_| OVERFLOWED)?;
    header.extend_from_slice(&seek_length.to_be_bytes()[1..]);
    header.extend_from_slice(seek_table);
    Ok(header)
}

fn placeholder_seek_table(sample_rate: u32) -> Result<Vec<u8>, BoxedError> {
    seek_table(&[], u64::MAX, sample_rate)
}

fn seek_table(
    positions: &[FramePosition],
    total_frames: u64,
    sample_rate: u32,
) -> Result<Vec<u8>, BoxedError> {
    let spacing = seek_spacing(total_frames, sample_rate)?;
    let count = total_frames.div_ceil(spacing);
    let mut table = vec![0_u8; SEEK_POINTS * SEEK_POINT_BYTES];
    for (index, point) in table.chunks_exact_mut(SEEK_POINT_BYTES).enumerate() {
        let sample = match u64::try_from(index) {
            Ok(value) if value < count => value * spacing,
            _ => SEEK_PLACEHOLDER,
        };
        let found = if sample == SEEK_PLACEHOLDER {
            None
        } else {
            containing_frame(positions, sample)
        };
        let Some(position) = found else {
            point[..size_of::<u64>()].fill(0xff);
            continue;
        };
        point[..size_of::<u64>()].copy_from_slice(&sample.to_be_bytes());
        point[size_of::<u64>()..size_of::<u64>() * 2]
            .copy_from_slice(&position.offset.to_be_bytes());
        point[size_of::<u64>() * 2..].copy_from_slice(&position.bytes.to_be_bytes());
    }
    Ok(table)
}

fn seek_spacing(total_frames: u64, sample_rate: u32) -> Result<u64, BoxedError> {
    let capacity = u64::try_from(SEEK_POINTS).map_err(|_| OVERFLOWED)?;
    Ok(total_frames
        .div_ceil(capacity)
        .max(SEEK_SECONDS * u64::from(sample_rate)))
}

fn containing_frame(positions: &[FramePosition], sample: u64) -> Option<&FramePosition> {
    let index = positions.partition_point(|position| position.first_sample <= sample);
    index.checked_sub(1).map(|found| &positions[found])
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

#[cfg(test)]
mod tests {
    use super::{SEEK_POINT_BYTES, SEEK_POINTS, containing_frame, seek_spacing, seek_table};

    const RATE: u32 = 48_000;

    struct Point<'point>(&'point [u8]);

    impl Point<'_> {
        fn sample(&self) -> u64 {
            u64::from_be_bytes(self.0[..8].try_into().expect("the sample is 8 bytes"))
        }

        fn offset(&self) -> u64 {
            u64::from_be_bytes(self.0[8..16].try_into().expect("the offset is 8 bytes"))
        }

        fn bytes(&self) -> u16 {
            u16::from_be_bytes(self.0[16..18].try_into().expect("the size is 2 bytes"))
        }

        fn is_placeholder(&self) -> bool {
            self.sample() == u64::MAX
        }
    }

    fn position(first_sample: u64) -> super::FramePosition {
        super::FramePosition {
            first_sample,
            offset: first_sample * 7,
            bytes: 4096,
        }
    }

    #[test]
    fn fills_a_placeholder_table_when_nothing_was_encoded() {
        let table = seek_table(&[], u64::MAX, RATE).expect("the table should be built");
        let points = table.chunks_exact(SEEK_POINT_BYTES).count();

        assert_eq!(points, SEEK_POINTS);
        assert!(
            table
                .chunks_exact(SEEK_POINT_BYTES)
                .all(|point| Point(point).is_placeholder())
        );
    }

    #[test]
    fn points_at_every_two_seconds_of_a_dense_track() {
        let spacing = seek_spacing(960_000, RATE).expect("the spacing should be built");
        let positions: Vec<_> = (0..235).map(|frame| position(frame * 4096)).collect();

        let table = seek_table(&positions, 960_000, RATE).expect("the table should be built");

        let points: Vec<_> = table
            .chunks_exact(SEEK_POINT_BYTES)
            .map(Point)
            .take_while(|point| !point.is_placeholder())
            .collect();
        assert_eq!(spacing, 96_000);
        assert_eq!(points.len(), 10);
        assert_eq!(points[0].sample(), 0);
        assert_eq!(points[1].sample(), 96_000);
        let holding_frame = position(23 * 4096);
        assert_eq!(points[1].offset(), holding_frame.offset);
        assert_eq!(points[1].bytes(), 4096);
    }

    #[test]
    fn widens_the_spacing_when_a_track_outgrows_the_table() {
        let long = 96_000_u64 * 4_000;

        let spacing = seek_spacing(long, RATE).expect("the spacing should be built");

        assert_eq!(spacing, 750_000);
        assert_eq!(long.div_ceil(spacing), u64::try_from(SEEK_POINTS).unwrap());
    }

    #[test]
    fn finds_the_frame_that_holds_the_seeking_sample() {
        let positions: Vec<_> = (0..10).map(|frame| position(frame * 4096)).collect();

        let found = containing_frame(&positions, 3 * 4096);
        let behind = containing_frame(&positions, 3 * 4096 - 1);

        assert_eq!(found.map(|frame| frame.first_sample), Some(3 * 4096));
        assert_eq!(behind.map(|frame| frame.first_sample), Some(2 * 4096));
    }
}
