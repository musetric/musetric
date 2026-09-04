use std::{
    fs::File,
    io::{BufReader, Read},
    path::Path,
};

use tokio::{fs::create_dir_all, task::spawn_blocking};

use crate::{
    AacEncoder, BoxedError,
    aac::FRAME_SAMPLES,
    flac::FlacWriter,
    fmp4::Fmp4Writer,
    pcm::{BYTES_PER_FRAME, CHANNELS, Frames, PcmRequest, PcmSource, READ_BUFFER_BYTE_LENGTH},
    resample::{Conversion, SampleRates},
};

const DELIVERY_BITRATE: u32 = 256_000;
const DELIVERY_CHANNELS: u8 = 2;

const _: () = assert!(DELIVERY_CHANNELS as usize == CHANNELS);

pub async fn convert_to_flac(
    source: &dyn PcmSource,
    request: PcmRequest<'_>,
    to: &Path,
) -> Result<(), BoxedError> {
    create_parent(to).await?;
    let mut writer = FlacWriter::create(to, request.sample_rate)?;
    encode_source(source, request, &mut writer).await?;
    writer.finish()
}

async fn encode_source(
    source: &dyn PcmSource,
    request: PcmRequest<'_>,
    writer: &mut FlacWriter,
) -> Result<(), BoxedError> {
    let mut sink = |chunk: &[f32]| write_frames(writer, chunk);
    source.read_pcm(request, &mut sink).await
}

pub async fn convert_to_fmp4(
    source: &dyn PcmSource,
    request: PcmRequest<'_>,
    to: &Path,
) -> Result<(), BoxedError> {
    create_parent(to).await?;
    let mut encoder = AacEncoder::create(request.sample_rate, DELIVERY_CHANNELS, DELIVERY_BITRATE)?;
    let mut failure: Option<BoxedError> = None;
    let mut sink = |chunk: &[f32]| {
        if failure.is_none()
            && let Err(error) = encoder.push(chunk)
        {
            failure = Some(error);
        }
    };
    source.read_pcm(request, &mut sink).await?;
    if let Some(error) = failure {
        return Err(error);
    }
    let frames = encoder.finish()?;
    let mut writer = Fmp4Writer::create(to, request.sample_rate, DELIVERY_CHANNELS)?;
    for packet in &frames {
        writer.push(packet, FRAME_SAMPLES)?;
    }
    writer.finish()
}

pub async fn encode_flac_from_raw(
    from: &Path,
    to: &Path,
    rates: SampleRates,
) -> Result<(), BoxedError> {
    create_parent(to).await?;
    let source = from.to_owned();
    let target = to.to_owned();
    spawn_blocking(move || encode_raw(&source, &target, rates)).await?
}

fn encode_raw(from: &Path, to: &Path, rates: SampleRates) -> Result<(), BoxedError> {
    let file = File::open(from)?;
    let read_frames = file.metadata()?.len() / BYTES_PER_FRAME as u64;
    let mut conversion = Conversion::create(rates)?;
    let mut writer = FlacWriter::create(to, rates.output)?;
    let mut reader = BufReader::with_capacity(READ_BUFFER_BYTE_LENGTH, file);
    let mut frames = Frames::default();
    let mut buffer = vec![0_u8; READ_BUFFER_BYTE_LENGTH];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        let converted = conversion.convert(frames.push(&buffer[..read]))?;
        write_frames(&mut writer, converted);
    }
    write_frames(
        &mut writer,
        conversion.flush(usize::try_from(read_frames)?)?,
    );
    writer.finish()
}

fn write_frames(writer: &mut FlacWriter, frames: &[f32]) {
    for frame in frames.chunks_exact(CHANNELS) {
        writer.push(frame[0], frame[1]);
    }
}

async fn create_parent(to: &Path) -> Result<(), BoxedError> {
    if let Some(directory) = to.parent() {
        create_dir_all(directory).await?;
    }
    Ok(())
}
