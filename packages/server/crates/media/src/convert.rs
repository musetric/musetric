use std::{
    fs::File,
    io::{BufReader, Read},
    path::Path,
};

use tokio::{fs::create_dir_all, task::spawn_blocking};

use crate::{
    Tools,
    flac::FlacWriter,
    pcm::{BYTES_PER_FRAME, CHANNELS, Frames, READ_BUFFER_BYTE_LENGTH, read_pcm},
    resample::{Conversion, SampleRates},
    run::{BoxedError, run},
};

const FRAGMENT_DURATION_MICROS: u32 = 2_000_000;

pub async fn convert_to_flac(
    tools: &Tools,
    from: &Path,
    to: &Path,
    sample_rate: u32,
) -> Result<(), BoxedError> {
    create_parent(to).await?;
    let mut writer = FlacWriter::create(to, sample_rate)?;
    read_pcm(tools, from, sample_rate, |left, right, _| {
        writer.push(left, right);
    })
    .await?;
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
    let mut conversion = Conversion::create(rates, usize::try_from(read_frames)?)?;
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
    write_frames(&mut writer, conversion.flush()?);
    writer.finish()
}

fn write_frames(writer: &mut FlacWriter, frames: &[f32]) {
    for frame in frames.chunks_exact(CHANNELS) {
        writer.push(frame[0], frame[1]);
    }
}

pub async fn convert_to_fmp4(
    tools: &Tools,
    from: &Path,
    to: &Path,
    sample_rate: u32,
) -> Result<(), BoxedError> {
    create_parent(to).await?;
    let fragment_duration = FRAGMENT_DURATION_MICROS.to_string();
    let arguments = vec![
        "-y".to_owned(),
        "-hide_banner".to_owned(),
        "-loglevel".to_owned(),
        "error".to_owned(),
        "-i".to_owned(),
        from.display().to_string(),
        "-map".to_owned(),
        "0:a:0".to_owned(),
        "-sn".to_owned(),
        "-dn".to_owned(),
        "-vn".to_owned(),
        "-ar".to_owned(),
        sample_rate.to_string(),
        "-c:a".to_owned(),
        "aac".to_owned(),
        "-profile:a".to_owned(),
        "aac_low".to_owned(),
        "-b:a".to_owned(),
        "256k".to_owned(),
        "-f".to_owned(),
        "mp4".to_owned(),
        "-movflags".to_owned(),
        "+frag_keyframe+empty_moov+default_base_moof".to_owned(),
        "-frag_duration".to_owned(),
        fragment_duration.clone(),
        "-min_frag_duration".to_owned(),
        fragment_duration,
        to.display().to_string(),
    ];
    run(&tools.ffmpeg, &arguments).await?;
    Ok(())
}

async fn create_parent(to: &Path) -> Result<(), BoxedError> {
    if let Some(directory) = to.parent() {
        create_dir_all(directory).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{convert_to_flac, encode_flac_from_raw};
    use crate::{
        Tools,
        fixture::{Fixture, Signal},
        frames::read_frame_count,
        pcm::{CHANNELS, decode_interleaved_pcm},
        resample::SampleRates,
        run::run,
    };

    const SOURCE_RATE: u32 = 44100;
    const TARGET_RATE: u32 = 48000;
    const SCALE: f32 = 8_388_608.0;
    const HIGHEST: f32 = 8_388_607.0;
    const SECONDS: f64 = 4.0;
    const TONE: &str =
        "0.6*sin(440*2*PI*t)*(0.2+0.8*abs(sin(1.3*t)))|0.45*sin(523.25*2*PI*t+sin(3*t))";
    const CORRELATION: f64 = 0.998;
    const LEVEL_TOLERANCE: f64 = 0.01;

    fn tone(name: &str, sample_rate: u32) -> Signal<'_> {
        Signal {
            name,
            expression: TONE,
            seconds: SECONDS,
            sample_rate,
        }
    }

    fn read_floats(bytes: &[u8]) -> Vec<f32> {
        bytes
            .chunks_exact(size_of::<f32>())
            .filter_map(|value| <[u8; 4]>::try_from(value).ok())
            .map(f32::from_le_bytes)
            .collect()
    }

    async fn decode(tools: &Tools, from: &Path, sample_rate: u32) -> Vec<f32> {
        let bytes = decode_interleaved_pcm(tools, from, sample_rate)
            .await
            .expect("the decoder should read the file");
        read_floats(&bytes)
    }

    async fn resampled_by_ffmpeg(fixture: &Fixture, from: &Path) -> Vec<f32> {
        let arguments = vec![
            "-hide_banner".to_owned(),
            "-loglevel".to_owned(),
            "error".to_owned(),
            "-f".to_owned(),
            "f32le".to_owned(),
            "-ar".to_owned(),
            SOURCE_RATE.to_string(),
            "-ac".to_owned(),
            "2".to_owned(),
            "-i".to_owned(),
            from.display().to_string(),
            "-ar".to_owned(),
            TARGET_RATE.to_string(),
            "-f".to_owned(),
            "f32le".to_owned(),
            "-".to_owned(),
        ];
        let bytes = run(&fixture.tools.ffmpeg, &arguments)
            .await
            .expect("ffmpeg should resample the raw stem");
        read_floats(&bytes)
    }

    fn quantized(value: f32) -> f32 {
        (value * SCALE).round().clamp(-SCALE, HIGHEST) / SCALE
    }

    fn energy(values: &[f32]) -> f64 {
        values.iter().map(|value| f64::from(*value).powi(2)).sum()
    }

    fn correlation(left: &[f32], right: &[f32]) -> f64 {
        let mut product = 0.0_f64;
        let mut left_energy = 0.0_f64;
        let mut right_energy = 0.0_f64;
        for (first, second) in left.iter().zip(right) {
            product += f64::from(*first) * f64::from(*second);
            left_energy += f64::from(*first) * f64::from(*first);
            right_energy += f64::from(*second) * f64::from(*second);
        }
        product / (left_energy.sqrt() * right_energy.sqrt())
    }

    #[tokio::test]
    async fn keeps_every_sample_of_a_decoded_upload() {
        let fixture = Fixture::create();
        let source = fixture.write_wav(&tone("source.wav", TARGET_RATE)).await;
        let master = fixture.join("master.flac");

        convert_to_flac(&fixture.tools, &source, &master, TARGET_RATE)
            .await
            .expect("the upload should be converted");

        let expected = decode(&fixture.tools, &source, TARGET_RATE).await;
        let written = decode(&fixture.tools, &master, TARGET_RATE).await;
        assert_eq!(written.len(), expected.len());
        assert_eq!(written, expected);
        let counted = read_frame_count(&fixture.tools, &master, TARGET_RATE)
            .await
            .expect("the master should report its duration");
        assert_eq!(counted, (expected.len() / CHANNELS) as u64);
    }

    #[tokio::test]
    async fn keeps_every_sample_of_a_raw_stem() {
        let fixture = Fixture::create();
        let raw = fixture.write_raw(&tone("stem.f32", TARGET_RATE)).await;
        let master = fixture.join("master.flac");
        let rates = SampleRates {
            input: TARGET_RATE,
            output: TARGET_RATE,
        };

        encode_flac_from_raw(&raw, &master, rates)
            .await
            .expect("the stem should be encoded");

        let source = read_floats(
            &tokio::fs::read(&raw)
                .await
                .expect("the raw stem should exist"),
        );
        let written = decode(&fixture.tools, &master, TARGET_RATE).await;
        assert_eq!(written.len(), source.len());
        let expected = source.iter().copied().map(quantized).collect::<Vec<_>>();
        assert_eq!(written, expected);
    }

    #[tokio::test]
    async fn resamples_the_stem_the_way_ffmpeg_does() {
        let fixture = Fixture::create();
        let raw = fixture.write_raw(&tone("stem.f32", SOURCE_RATE)).await;
        let master = fixture.join("master.flac");
        let rates = SampleRates {
            input: SOURCE_RATE,
            output: TARGET_RATE,
        };

        encode_flac_from_raw(&raw, &master, rates)
            .await
            .expect("the stem should be encoded");

        let expected = resampled_by_ffmpeg(&fixture, &raw).await;
        let written = decode(&fixture.tools, &master, TARGET_RATE).await;
        assert_eq!(written.len(), expected.len());
        let measured = correlation(&written, &expected);
        assert!(measured > CORRELATION, "correlation {measured}");
        let level = (energy(&written) / energy(&expected)).sqrt();
        assert!((level - 1.0).abs() < LEVEL_TOLERANCE, "level {level}");
    }
}
