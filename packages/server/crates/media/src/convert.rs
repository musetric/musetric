use std::{
    fs::File,
    io::{BufReader, BufWriter, Read, Seek, Write},
    path::Path,
};

use musetric_dsp::{
    SAMPLE_BITS,
    flac::FlacWriter,
    resample::{Conversion, SampleRates},
};
use tokio::{
    fs::{copy, create_dir_all},
    task::spawn_blocking,
};

use crate::{
    BoxedError,
    file::create_buffered,
    frames::read_flac_info,
    pcm::{
        BYTES_PER_FRAME, CHANNELS, Frames, PcmRequest, PcmSource, READ_BUFFER_BYTE_LENGTH,
        SourceFailure,
    },
};

pub async fn convert_to_flac(
    source: &dyn PcmSource,
    request: PcmRequest<'_>,
    to: &Path,
) -> Result<(), BoxedError> {
    create_parent(to).await?;
    if already_master(request.from, request.sample_rate).await {
        if request.from != to {
            copy(request.from, to).await?;
        }
        return Ok(());
    }
    let mut writer = FlacWriter::create(create_buffered(to)?, request.sample_rate)?;
    encode_source(source, request, &mut writer).await?;
    writer.finish()?;
    Ok(())
}

async fn already_master(from: &Path, sample_rate: u32) -> bool {
    read_flac_info(from).await.is_ok_and(|info| {
        info.sample_rate == sample_rate
            && usize::try_from(info.channels) == Ok(CHANNELS)
            && usize::try_from(info.sample_bits) == Ok(SAMPLE_BITS)
    })
}

async fn encode_source(
    source: &dyn PcmSource,
    request: PcmRequest<'_>,
    writer: &mut FlacWriter<BufWriter<File>>,
) -> Result<(), BoxedError> {
    let mut sink = |chunk: &[f32]| write_frames(writer, chunk);
    source
        .read_pcm(request, &mut sink)
        .await
        .map_err(|failure| SourceFailure(failure).into())
}

pub async fn encode_flac_from_raw(
    from: &Path,
    to: &Path,
    rates: SampleRates,
    scale: f64,
) -> Result<(), BoxedError> {
    create_parent(to).await?;
    let source = from.to_owned();
    let target = to.to_owned();
    spawn_blocking(move || encode_raw(&source, &target, rates, scale)).await?
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "the scale reproduces the browser float32 arithmetic"
)]
fn scale_samples<'scaled>(
    samples: &[f32],
    scale: f64,
    scaled: &'scaled mut Vec<f32>,
) -> &'scaled [f32] {
    scaled.clear();
    scaled.extend(
        samples
            .iter()
            .map(|value| (f64::from(*value) * scale) as f32),
    );
    scaled
}

fn encode_raw(from: &Path, to: &Path, rates: SampleRates, scale: f64) -> Result<(), BoxedError> {
    let file = File::open(from)?;
    let read_frames = file.metadata()?.len() / BYTES_PER_FRAME as u64;
    let mut conversion = Conversion::create(rates, CHANNELS)?;
    let mut writer = FlacWriter::create(create_buffered(to)?, rates.output)?;
    let mut reader = BufReader::with_capacity(READ_BUFFER_BYTE_LENGTH, file);
    let mut frames = Frames::default();
    let mut buffer = vec![0_u8; READ_BUFFER_BYTE_LENGTH];
    let mut scaled = Vec::new();
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        let converted = conversion.convert(scale_samples(
            frames.push(&buffer[..read]),
            scale,
            &mut scaled,
        ))?;
        write_frames(&mut writer, converted);
    }
    write_frames(
        &mut writer,
        conversion.flush(usize::try_from(read_frames)?)?,
    );
    writer.finish()?;
    Ok(())
}

fn write_frames<W: Write + Seek>(writer: &mut FlacWriter<W>, frames: &[f32]) {
    for frame in frames.as_chunks::<CHANNELS>().0 {
        writer.push(frame[0], frame[1]);
    }
}

async fn create_parent(to: &Path) -> Result<(), BoxedError> {
    if let Some(directory) = to.parent() {
        create_dir_all(directory).await?;
    }
    Ok(())
}
