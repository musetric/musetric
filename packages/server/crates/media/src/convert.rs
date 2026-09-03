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

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{convert_to_flac, convert_to_fmp4, encode_flac_from_raw};
    use crate::{
        fixture::{Fixture, Partial, Signal, correlation, level, read_floats},
        frames::read_frame_count,
        pcm::{CHANNELS, PcmRequest, collect_interleaved_pcm},
        resample::SampleRates,
    };

    const SOURCE_RATE: u32 = 44100;
    const TARGET_RATE: u32 = 48000;
    const SCALE: f32 = 8_388_608.0;
    const HIGHEST: f32 = 8_388_607.0;
    const SECONDS: f64 = 2.0;
    const DELIVERY_SECONDS: f64 = 4.0;
    const CORRELATION: f64 = 0.99;
    const LEVEL_TOLERANCE: f64 = 0.02;
    const FRAGMENT_MARKER: &[u8] = b"moof";
    const EXPECTED_FRAGMENTS: usize = 3;
    const AAC_PRIMING: usize = 1024;

    fn count_fragments(bytes: &[u8]) -> usize {
        let mut position = 0usize;
        let mut count = 0usize;
        while position + 8 <= bytes.len() {
            let Ok(length) = <[u8; 4]>::try_from(&bytes[position..position + 4]) else {
                break;
            };
            let size = usize::try_from(u32::from_be_bytes(length)).unwrap_or(0);
            if size < 8 || position + size > bytes.len() {
                break;
            }
            if &bytes[position + 4..position + 8] == FRAGMENT_MARKER {
                count += 1;
            }
            position += size;
        }
        count
    }

    const LEFT: [Partial; 2] = [
        Partial {
            frequency: 440.0,
            amplitude: 0.6,
            phase: 0.0,
        },
        Partial {
            frequency: 523.25,
            amplitude: 0.45,
            phase: 1.0,
        },
    ];
    const RIGHT: [Partial; 2] = [
        Partial {
            frequency: 330.0,
            amplitude: 0.5,
            phase: 0.0,
        },
        Partial {
            frequency: 659.26,
            amplitude: 0.35,
            phase: 2.0,
        },
    ];

    fn tone(name: &'static str, seconds: f64, sample_rate: u32) -> Signal<'static> {
        Signal {
            name,
            seconds,
            sample_rate,
            left: &LEFT,
            right: &RIGHT,
            gate: None,
        }
    }

    async fn decode(fixture: &Fixture, from: &Path, sample_rate: u32) -> Vec<f32> {
        let request = PcmRequest { from, sample_rate };
        let bytes = collect_interleaved_pcm(&fixture.pcm, request)
            .await
            .expect("the decoder should read the file");
        read_floats(&bytes)
    }

    fn quantized(value: f32) -> f32 {
        (value * SCALE).round().clamp(-SCALE, HIGHEST) / SCALE
    }

    #[tokio::test]
    async fn keeps_every_sample_of_a_decoded_upload() {
        let fixture = Fixture::create();
        let defined = tone("source.wav", SECONDS, TARGET_RATE);
        let source = fixture.write_wav24(&defined);
        let master = fixture.join("master.flac");

        let request = PcmRequest {
            from: &source,
            sample_rate: TARGET_RATE,
        };
        convert_to_flac(&fixture.pcm, request, &master)
            .await
            .expect("the upload should be converted");

        let expected = crate::fixture::render(&defined)
            .iter()
            .copied()
            .map(quantized)
            .collect::<Vec<_>>();
        let written = decode(&fixture, &master, TARGET_RATE).await;
        assert_eq!(written.len(), expected.len());
        assert_eq!(written, expected);
        let counted = read_frame_count(&master)
            .await
            .expect("the master should report its duration");
        assert_eq!(counted, (expected.len() / CHANNELS) as u64);
    }

    #[tokio::test]
    async fn keeps_every_sample_of_a_raw_stem() {
        let fixture = Fixture::create();
        let defined = tone("stem.f32", SECONDS, TARGET_RATE);
        let raw = fixture.write_raw(&defined);
        let master = fixture.join("master.flac");
        let rates = SampleRates {
            input: TARGET_RATE,
            output: TARGET_RATE,
        };

        encode_flac_from_raw(&raw, &master, rates)
            .await
            .expect("the stem should be encoded");

        let source = crate::fixture::render(&defined);
        let written = decode(&fixture, &master, TARGET_RATE).await;
        assert_eq!(written.len(), source.len());
        let expected = source.iter().copied().map(quantized).collect::<Vec<_>>();
        assert_eq!(written, expected);
    }

    #[tokio::test]
    async fn resamples_the_stem_the_way_the_reference_does() {
        let fixture = Fixture::create();
        let defined = tone("stem.f32", SECONDS, SOURCE_RATE);
        let raw = fixture.write_raw(&defined);
        let master = fixture.join("master.flac");
        let rates = SampleRates {
            input: SOURCE_RATE,
            output: TARGET_RATE,
        };

        encode_flac_from_raw(&raw, &master, rates)
            .await
            .expect("the stem should be encoded");

        let expected = read_floats(
            &tokio::fs::read(Fixture::asset("resample.pcm"))
                .await
                .expect("the golden pcm should exist"),
        );
        let written = decode(&fixture, &master, TARGET_RATE).await;
        assert_eq!(written.len(), expected.len());
        let matched = correlation(&written, &expected);
        assert!(matched > CORRELATION, "correlation {matched}");
        let gain = level(&written, &expected);
        assert!((gain - 1.0).abs() < LEVEL_TOLERANCE, "level {gain}");
    }

    #[tokio::test]
    async fn delivers_a_fragmented_master_the_player_reads() {
        let fixture = Fixture::create();
        let defined = tone("source.wav", DELIVERY_SECONDS, TARGET_RATE);
        let source = fixture.write_wav24(&defined);
        let master = fixture.join("master.flac");
        let delivery = fixture.join("delivery.m4s");

        let request = PcmRequest {
            from: &source,
            sample_rate: TARGET_RATE,
        };
        convert_to_flac(&fixture.pcm, request, &master)
            .await
            .expect("the upload should be converted");
        convert_to_fmp4(
            &fixture.pcm,
            PcmRequest {
                from: &master,
                sample_rate: TARGET_RATE,
            },
            &delivery,
        )
        .await
        .expect("the delivery should be muxed");

        let stored = tokio::fs::read(&delivery)
            .await
            .expect("the delivery should be readable");
        let fragments = count_fragments(&stored);
        assert_eq!(fragments, EXPECTED_FRAGMENTS);

        let delivered = decode(&fixture, &delivery, TARGET_RATE).await;
        let original = crate::fixture::render(&defined);
        let body = &delivered[AAC_PRIMING * CHANNELS..AAC_PRIMING * CHANNELS + original.len()];
        let matched = correlation(body, &original);
        assert!(matched > CORRELATION, "correlation {matched}");
        let gain = level(body, &original);
        assert!((gain - 1.0).abs() < LEVEL_TOLERANCE, "level {gain}");
    }
}
