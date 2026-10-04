use std::{
    fs::File,
    io::{BufWriter, Write},
    path::{Path, PathBuf},
};

use rusty_mp3::{Error, Mp3Encoder, Mp3EncoderConfig};
use tokio::task::spawn_blocking;

use crate::{
    AacEncoder, BoxedError, Downmix, MonoRequest, SampleDepth, decode_mono_pcm,
    flac::FlacWriter,
    m4a::{M4aTrack, write_m4a},
    pcm::{CHANNELS, PcmRequest, PcmSource},
    wav::WavWriter,
};

const PEAK_CEILING: f32 = 0.891_250_9;
const KILOBIT: u32 = 1000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MixdownFormat {
    M4a { bitrate: u32 },
    Mp3 { bitrate: u32 },
    Flac(SampleDepth),
    Wav(SampleDepth),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MixdownChannels {
    Stereo,
    Mono,
}

pub struct MixdownTrack {
    pub from: PathBuf,
    pub gain: f32,
    pub channels: MixdownChannels,
    pub lead_in: usize,
}

pub struct Mixdown {
    pub sample_rate: u32,
    pub frame_count: usize,
    pub tracks: Vec<MixdownTrack>,
    pub format: MixdownFormat,
}

pub async fn write_mixdown(
    source: &dyn PcmSource,
    mixdown: Mixdown,
    to: &Path,
) -> Result<(), BoxedError> {
    let mut mixed = vec![0.0_f32; mixdown.frame_count * CHANNELS];
    for track in &mixdown.tracks {
        add_track(source, mixdown.sample_rate, track, &mut mixed).await?;
    }
    limit_peak(&mut mixed);
    let target = to.to_owned();
    spawn_blocking(move || encode(&mixed, mixdown.sample_rate, mixdown.format, &target)).await?
}

async fn add_track(
    source: &dyn PcmSource,
    sample_rate: u32,
    track: &MixdownTrack,
    mixed: &mut [f32],
) -> Result<(), BoxedError> {
    let request = PcmRequest {
        from: &track.from,
        sample_rate,
    };
    match track.channels {
        MixdownChannels::Stereo => add_stereo(source, request, track, mixed).await,
        MixdownChannels::Mono => add_mono(source, request, track, mixed).await,
    }
}

async fn add_stereo(
    source: &dyn PcmSource,
    request: PcmRequest<'_>,
    track: &MixdownTrack,
    mixed: &mut [f32],
) -> Result<(), BoxedError> {
    let mut frame = 0_usize;
    let mut sink = |chunk: &[f32]| {
        for pair in chunk.chunks_exact(CHANNELS) {
            add_frame(mixed, frame, track, [pair[0], pair[1]]);
            frame += 1;
        }
    };
    source.read_pcm(request, &mut sink).await
}

async fn add_mono(
    source: &dyn PcmSource,
    request: PcmRequest<'_>,
    track: &MixdownTrack,
    mixed: &mut [f32],
) -> Result<(), BoxedError> {
    let bytes = decode_mono_pcm(MonoRequest {
        source,
        request,
        downmix: Downmix::Power,
        decoded: &mut |_| {},
    })
    .await?;
    for (frame, value) in bytes.chunks_exact(size_of::<f32>()).enumerate() {
        let sample = <[u8; 4]>::try_from(value).map_or(0.0, f32::from_le_bytes);
        add_frame(mixed, frame, track, [sample, sample]);
    }
    Ok(())
}

fn add_frame(mixed: &mut [f32], frame: usize, track: &MixdownTrack, [left, right]: [f32; 2]) {
    let Some(target) = frame.checked_sub(track.lead_in) else {
        return;
    };
    let Some(pair) = mixed.get_mut(target * CHANNELS..(target + 1) * CHANNELS) else {
        return;
    };
    pair[0] += left * track.gain;
    pair[1] += right * track.gain;
}

fn limit_peak(mixed: &mut [f32]) {
    let peak = mixed
        .iter()
        .fold(0.0_f32, |peak, value| peak.max(value.abs()));
    if peak <= PEAK_CEILING {
        return;
    }
    let scale = PEAK_CEILING / peak;
    for value in mixed {
        *value *= scale;
    }
}

fn encode(
    mixed: &[f32],
    sample_rate: u32,
    format: MixdownFormat,
    to: &Path,
) -> Result<(), BoxedError> {
    match format {
        MixdownFormat::M4a { bitrate } => encode_m4a(mixed, sample_rate, bitrate, to),
        MixdownFormat::Mp3 { bitrate } => encode_mp3(mixed, sample_rate, bitrate, to),
        MixdownFormat::Flac(depth) => {
            let mut writer = FlacWriter::create(to, sample_rate, depth)?;
            for pair in mixed.chunks_exact(CHANNELS) {
                writer.push(pair[0], pair[1]);
            }
            writer.finish()
        }
        MixdownFormat::Wav(depth) => {
            let mut writer = WavWriter::create(to, sample_rate, depth, mixed.len() / CHANNELS)?;
            for pair in mixed.chunks_exact(CHANNELS) {
                writer.push(pair[0], pair[1])?;
            }
            writer.finish()
        }
    }
}

fn encode_m4a(mixed: &[f32], sample_rate: u32, bitrate: u32, to: &Path) -> Result<(), BoxedError> {
    let channels = u8::try_from(CHANNELS)?;
    let mut encoder = AacEncoder::create(sample_rate, channels, bitrate)?;
    encoder.push(mixed)?;
    let packets = encoder.finish()?;
    let frame_count = u32::try_from(mixed.len() / CHANNELS)?;
    write_m4a(
        to,
        &M4aTrack {
            sample_rate,
            channels,
            packets: &packets,
            frame_count,
        },
    )
}

fn encode_mp3(mixed: &[f32], sample_rate: u32, bitrate: u32, to: &Path) -> Result<(), BoxedError> {
    let mut encoder = Mp3Encoder::new(Mp3EncoderConfig {
        bitrate_kbps: bitrate / KILOBIT,
        vbr_quality: None,
    });
    encoder.push_pcm_f32(mixed, u16::try_from(CHANNELS)?, sample_rate)?;
    encoder.finish();
    let mut file = BufWriter::new(File::create(to)?);
    loop {
        match encoder.next_packet() {
            Ok(packet) => file.write_all(&packet)?,
            Err(Error::Eof) => break,
            Err(failure) => return Err(failure.into()),
        }
    }
    file.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{
        f32::consts::FRAC_1_SQRT_2,
        fs::{create_dir_all, read, remove_dir_all},
        path::{Path, PathBuf},
    };

    use super::{
        Mixdown, MixdownChannels, MixdownFormat, MixdownTrack, PEAK_CEILING, write_mixdown,
    };
    use crate::{PcmRequest, PcmSink, PcmSource, ReadingPcm, SampleDepth};

    const RATE: u32 = 48_000;
    const WAV_HEADER_BYTES: usize = 44;
    const TOLERANCE: f32 = 1e-5;

    struct Fixture(Vec<(PathBuf, Vec<f32>)>);

    impl PcmSource for Fixture {
        fn read_pcm<'source>(
            &'source self,
            request: PcmRequest<'source>,
            sink: PcmSink<'source>,
        ) -> ReadingPcm<'source> {
            let found = self
                .0
                .iter()
                .find(|(path, _)| path == request.from)
                .map(|(_, samples)| samples.clone())
                .unwrap_or_default();
            Box::pin(async move {
                sink(&found);
                Ok(())
            })
        }
    }

    fn stem(from: &Path, gain: f32) -> MixdownTrack {
        MixdownTrack {
            from: from.to_owned(),
            gain,
            channels: MixdownChannels::Stereo,
            lead_in: 0,
        }
    }

    #[expect(
        clippy::cast_precision_loss,
        reason = "a 24-bit sample fits the f32 mantissa"
    )]
    fn read_wav(path: &Path) -> Vec<f32> {
        let bytes = read(path).expect("the mixdown should be written");
        bytes[WAV_HEADER_BYTES..]
            .chunks_exact(3)
            .map(|sample| {
                (i32::from_le_bytes([0, sample[0], sample[1], sample[2]]) >> 8) as f32 / 8_388_608.0
            })
            .collect()
    }

    async fn mix(name: &str, fixture: &Fixture, tracks: Vec<MixdownTrack>) -> Vec<f32> {
        let directory =
            std::env::temp_dir().join(format!("musetric-mixdown-{name}-{}", std::process::id()));
        create_dir_all(&directory).expect("the workspace should be created");
        let to = directory.join("mix.wav");
        let mixdown = Mixdown {
            sample_rate: RATE,
            frame_count: 8,
            tracks,
            format: MixdownFormat::Wav(SampleDepth::TwentyFour),
        };
        write_mixdown(fixture, mixdown, &to)
            .await
            .expect("the mixdown should be written");
        let mixed = read_wav(&to);
        remove_dir_all(&directory).expect("the workspace should be removed");
        mixed
    }

    #[tokio::test]
    async fn mixes_the_stems_and_the_take_on_the_heard_timeline() {
        let instrumental = PathBuf::from("instrumental.flac");
        let take = PathBuf::from("take.wav");
        let take_frames: Vec<f32> = (0..12_u16)
            .flat_map(|frame| [f32::from(frame) * 0.01 * FRAC_1_SQRT_2; 2])
            .collect();
        let fixture = Fixture(vec![
            (instrumental.clone(), [0.1, 0.2].repeat(8)),
            (take.clone(), take_frames),
        ]);
        let tracks = vec![
            stem(&instrumental, 0.5),
            MixdownTrack {
                from: take,
                gain: 2.0,
                channels: MixdownChannels::Mono,
                lead_in: 3,
            },
        ];

        let mixed = mix("timeline", &fixture, tracks).await;

        for (frame, pair) in (0..8_u16).zip(mixed.chunks_exact(2)) {
            let sung = 0.02 * f32::from(frame + 3);
            assert!(
                (pair[0] - (0.05 + sung)).abs() < TOLERANCE,
                "{frame}: {pair:?}"
            );
            assert!(
                (pair[1] - (0.1 + sung)).abs() < TOLERANCE,
                "{frame}: {pair:?}"
            );
        }
    }

    #[tokio::test]
    async fn lowers_a_hot_mix_to_the_ceiling() {
        let lead = PathBuf::from("lead.flac");
        let backing = PathBuf::from("backing.flac");
        let fixture = Fixture(vec![
            (lead.clone(), [0.8, 0.8].repeat(8)),
            (backing.clone(), [0.8, -0.4].repeat(8)),
        ]);

        let mixed = mix(
            "ceiling",
            &fixture,
            vec![stem(&lead, 1.0), stem(&backing, 1.0)],
        )
        .await;

        assert!((mixed[0] - PEAK_CEILING).abs() < TOLERANCE, "{mixed:?}");
        assert!(
            (mixed[1] - PEAK_CEILING * 0.25).abs() < TOLERANCE,
            "{mixed:?}"
        );
    }
}
