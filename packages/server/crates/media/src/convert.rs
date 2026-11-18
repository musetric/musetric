use std::{
    fs::File,
    io::{BufReader, BufWriter, Read, Seek, Write},
    path::Path,
};

use musetric_dsp::{
    depth::SampleDepth,
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
    let mut writer = FlacWriter::create(
        create_buffered(to)?,
        request.sample_rate,
        SampleDepth::TwentyFour,
    )?;
    encode_source(source, request, &mut writer).await?;
    writer.finish()?;
    Ok(())
}

async fn already_master(from: &Path, sample_rate: u32) -> bool {
    read_flac_info(from).await.is_ok_and(|info| {
        info.sample_rate == sample_rate && usize::try_from(info.channels) == Ok(CHANNELS)
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
    let mut writer =
        FlacWriter::create(create_buffered(to)?, rates.output, SampleDepth::TwentyFour)?;
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

#[cfg(test)]
mod tests {
    use std::fs::{create_dir_all, remove_dir_all, write};

    use musetric_dsp::resample::SampleRates;

    use super::{convert_to_flac, encode_flac_from_raw};
    use crate::{PcmRequest, PcmSource, SourceFailure, SymphoniaPcm};

    const RATE: u32 = 48_000;

    #[tokio::test]
    async fn scales_the_raw_samples_before_it_encodes_them() {
        let directory =
            std::env::temp_dir().join(format!("musetric-scaled-{}", std::process::id()));
        create_dir_all(&directory).expect("the workspace should be created");
        let raw = directory.join("stem.raw");
        let master = directory.join("stem.flac");
        let samples: Vec<f32> = (0..2_000_u16)
            .map(|index| f32::from(index % 9) / 8.0 - 0.5)
            .collect();
        let bytes: Vec<u8> = samples
            .iter()
            .flat_map(|value| value.to_le_bytes())
            .collect();
        write(&raw, bytes).expect("the raw stem should be written");
        let rates = SampleRates {
            input: RATE,
            output: RATE,
        };

        encode_flac_from_raw(&raw, &master, rates, 0.5)
            .await
            .expect("the stem should encode");
        let mut decoded = Vec::new();
        let mut sink = |chunk: &[f32]| decoded.extend_from_slice(chunk);
        SymphoniaPcm
            .read_pcm(
                PcmRequest {
                    from: &master,
                    sample_rate: RATE,
                },
                &mut sink,
            )
            .await
            .expect("the master should decode");
        remove_dir_all(&directory).expect("the workspace should be removed");

        assert_eq!(decoded.len(), samples.len());
        for (found, sample) in decoded.iter().zip(&samples) {
            assert!((found - sample * 0.5).abs() < 1e-6);
        }
    }

    #[tokio::test]
    async fn tells_an_unreadable_source_from_a_failed_write() {
        let directory =
            std::env::temp_dir().join(format!("musetric-convert-{}", std::process::id()));
        create_dir_all(&directory).expect("the workspace should be created");
        let garbage = directory.join("song.mp3");
        write(&garbage, b"not audio at all").expect("the input should be written");
        let blocked = directory.join("blocked");
        create_dir_all(&blocked).expect("the blocking directory should be created");
        let request = PcmRequest {
            from: &garbage,
            sample_rate: 48_000,
        };

        let unreadable = convert_to_flac(&SymphoniaPcm, request, &directory.join("out.flac"))
            .await
            .expect_err("garbage should not convert");
        let refused = convert_to_flac(&SymphoniaPcm, request, &blocked)
            .await
            .expect_err("a directory should not take the master");
        remove_dir_all(&directory).expect("the workspace should be removed");

        assert!(unreadable.is::<SourceFailure>());
        assert!(!refused.is::<SourceFailure>());
    }
}
