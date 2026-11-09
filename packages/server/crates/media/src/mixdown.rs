use std::{
    fs::File,
    io::{BufWriter, Write},
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
};

use musetric_stretch::{Refusal, Stretch};
use rusty_mp3::{Error, Mp3Encoder, Mp3EncoderConfig};
use tokio::task::{JoinHandle, spawn_blocking};

use crate::{
    AacEncoder, BoxedError, Downmix, MonoRequest, SampleDepth, decode_mono_pcm,
    flac::FlacWriter,
    m4a::{M4aTrack, write_m4a},
    pcm::{CHANNELS, PcmRequest, PcmSource},
    wav::WavWriter,
};

const PEAK_CEILING: f32 = 0.891_250_9;
const KILOBIT: u32 = 1000;
const ORIGINAL_TEMPO_PERCENT: usize = 100;
const TOO_SHORT: &str = "The song is too short to change its tempo or key";
const STOPPED: &str = "The mixdown was stopped";
const ENCODED_FRAMES: usize = 65_536;

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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MixdownGroup {
    Song,
    Lead,
    Ready,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MixdownChange {
    pub tempo_percent: usize,
    pub semitones: i32,
    pub lead_semitones: i32,
}

impl MixdownChange {
    pub const ORIGINAL: Self = Self {
        tempo_percent: ORIGINAL_TEMPO_PERCENT,
        semitones: 0,
        lead_semitones: 0,
    };

    #[must_use]
    pub const fn frame_count(self, source_frames: usize) -> usize {
        (source_frames * ORIGINAL_TEMPO_PERCENT + self.tempo_percent / 2) / self.tempo_percent
    }

    const fn semitones_of(self, group: MixdownGroup) -> i32 {
        match group {
            MixdownGroup::Lead => self.lead_semitones,
            MixdownGroup::Song | MixdownGroup::Ready => self.semitones,
        }
    }
}

pub struct MixdownTrack {
    pub from: PathBuf,
    pub gain: f32,
    pub channels: MixdownChannels,
    pub lead_in: usize,
    pub group: MixdownGroup,
}

pub struct Mixdown {
    pub sample_rate: u32,
    pub frame_count: usize,
    pub tracks: Vec<MixdownTrack>,
    pub format: MixdownFormat,
    pub change: MixdownChange,
}

type Stretching = JoinHandle<Result<Vec<Vec<f32>>, Refusal>>;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MixdownStage {
    Mixing,
    Stretching,
    Encoding,
}

const STAGES: [MixdownStage; 3] = [
    MixdownStage::Mixing,
    MixdownStage::Stretching,
    MixdownStage::Encoding,
];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MixdownProgress {
    pub stage: MixdownStage,
    pub done: Option<f64>,
}

#[derive(Default)]
pub struct MixdownWatch {
    stage: AtomicUsize,
    done: [AtomicUsize; 3],
    total: [AtomicUsize; 3],
    stopped: AtomicBool,
}

impl MixdownWatch {
    pub fn stop(&self) {
        self.stopped.store(true, Ordering::Relaxed);
    }

    #[must_use]
    pub fn stopped(&self) -> bool {
        self.stopped.load(Ordering::Relaxed)
    }

    #[must_use]
    #[expect(
        clippy::cast_precision_loss,
        reason = "a share of the frames of a song needs far less than the f64 mantissa"
    )]
    pub fn progress(&self) -> MixdownProgress {
        let index = self.stage.load(Ordering::Relaxed);
        let total = self.total[index].load(Ordering::Relaxed);
        let done = self.done[index].load(Ordering::Relaxed);
        MixdownProgress {
            stage: STAGES[index],
            done: (total > 0).then(|| (done as f64 / total as f64).min(1.0)),
        }
    }

    fn plan(&self, stage: MixdownStage, amount: usize) {
        self.total[stage as usize].fetch_add(amount, Ordering::Relaxed);
    }

    fn enter(&self, stage: MixdownStage) {
        self.stage.store(stage as usize, Ordering::Relaxed);
    }

    fn advance(&self, stage: MixdownStage, amount: usize) {
        self.done[stage as usize].fetch_add(amount, Ordering::Relaxed);
    }

    fn check(&self) -> Result<(), BoxedError> {
        if self.stopped() {
            return Err(STOPPED.into());
        }
        Ok(())
    }
}

#[derive(Clone, Copy)]
struct Reading<'mixdown> {
    source: &'mixdown dyn PcmSource,
    sample_rate: u32,
    watch: &'mixdown MixdownWatch,
}

struct Output<'mixdown> {
    sample_rate: u32,
    format: MixdownFormat,
    to: &'mixdown Path,
    watch: &'mixdown MixdownWatch,
}

pub async fn write_mixdown(
    source: &dyn PcmSource,
    mixdown: Mixdown,
    to: &Path,
    watch: &Arc<MixdownWatch>,
) -> Result<(), BoxedError> {
    let reading = Reading {
        source,
        sample_rate: mixdown.sample_rate,
        watch,
    };
    let frame_count = mixdown.change.frame_count(mixdown.frame_count);
    let mut mixed = vec![0.0_f32; frame_count * CHANNELS];
    let mut stretching = Vec::new();
    watch.plan(MixdownStage::Mixing, mixdown.tracks.len());
    for group in [MixdownGroup::Song, MixdownGroup::Lead] {
        let tracks: Vec<&MixdownTrack> = mixdown
            .tracks
            .iter()
            .filter(|track| track.group == group)
            .collect();
        if tracks.is_empty() {
            continue;
        }
        let semitones = mixdown.change.semitones_of(group);
        if mixdown.change.tempo_percent == ORIGINAL_TEMPO_PERCENT && semitones == 0 {
            for track in tracks {
                add_track(reading, track, &mut mixed).await?;
            }
            continue;
        }
        let mut song = vec![0.0_f32; mixdown.frame_count * CHANNELS];
        for track in tracks {
            add_track(reading, track, &mut song).await?;
        }
        let stretch = Stretch {
            sample_rate: mixdown.sample_rate,
            frame_count,
            semitones,
            keep_formants: group == MixdownGroup::Lead,
        };
        stretching.push(spawn_stretch(stretch, &song, watch));
    }
    add_stretched(stretching, &mut mixed, watch).await?;
    for track in mixdown
        .tracks
        .iter()
        .filter(|track| track.group == MixdownGroup::Ready)
    {
        add_track(reading, track, &mut mixed).await?;
    }
    limit_peak(&mut mixed);
    let target = to.to_owned();
    let encoding = Arc::clone(watch);
    spawn_blocking(move || {
        encode(
            &mixed,
            &Output {
                sample_rate: mixdown.sample_rate,
                format: mixdown.format,
                to: &target,
                watch: &encoding,
            },
        )
    })
    .await?
}

fn spawn_stretch(stretch: Stretch, song: &[f32], watch: &Arc<MixdownWatch>) -> Stretching {
    let channels = deinterleave(song);
    let stretching = Arc::clone(watch);
    watch.plan(MixdownStage::Stretching, stretch.frame_count);
    spawn_blocking(move || {
        let mut reported = 0;
        stretch.apply(&channels, &mut |written| {
            stretching.advance(MixdownStage::Stretching, written - reported);
            reported = written;
            !stretching.stopped()
        })
    })
}

async fn add_stretched(
    stretching: Vec<Stretching>,
    mixed: &mut [f32],
    watch: &MixdownWatch,
) -> Result<(), BoxedError> {
    if !stretching.is_empty() {
        watch.enter(MixdownStage::Stretching);
    }
    for task in stretching {
        let channels = task.await?.map_err(|refusal| match refusal {
            Refusal::TooShort => TOO_SHORT,
            Refusal::Stopped => STOPPED,
        })?;
        for (frame, pair) in mixed.as_chunks_mut::<CHANNELS>().0.iter_mut().enumerate() {
            pair[0] += channels[0][frame];
            pair[1] += channels[1][frame];
        }
    }
    Ok(())
}

fn deinterleave(song: &[f32]) -> Vec<Vec<f32>> {
    (0..CHANNELS)
        .map(|channel| {
            song.iter()
                .skip(channel)
                .step_by(CHANNELS)
                .copied()
                .collect()
        })
        .collect()
}

async fn add_track(
    reading: Reading<'_>,
    track: &MixdownTrack,
    mixed: &mut [f32],
) -> Result<(), BoxedError> {
    reading.watch.check()?;
    let request = PcmRequest {
        from: &track.from,
        sample_rate: reading.sample_rate,
    };
    match track.channels {
        MixdownChannels::Stereo => add_stereo(reading.source, request, track, mixed).await?,
        MixdownChannels::Mono => add_mono(reading.source, request, track, mixed).await?,
    }
    reading.watch.advance(MixdownStage::Mixing, 1);
    Ok(())
}

async fn add_stereo(
    source: &dyn PcmSource,
    request: PcmRequest<'_>,
    track: &MixdownTrack,
    mixed: &mut [f32],
) -> Result<(), BoxedError> {
    let mut frame = 0_usize;
    let mut sink = |chunk: &[f32]| {
        for pair in chunk.as_chunks::<CHANNELS>().0 {
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
    for (frame, value) in bytes
        .as_chunks::<{ size_of::<f32>() }>()
        .0
        .iter()
        .enumerate()
    {
        let sample = f32::from_le_bytes(*value);
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

fn encode(mixed: &[f32], output: &Output<'_>) -> Result<(), BoxedError> {
    let frames = mixed.as_chunks::<CHANNELS>().0;
    let chunks = frames.chunks(ENCODED_FRAMES);
    let watch = output.watch;
    if !matches!(output.format, MixdownFormat::M4a { .. }) {
        watch.plan(MixdownStage::Encoding, frames.len());
    }
    watch.enter(MixdownStage::Encoding);
    match output.format {
        MixdownFormat::M4a { bitrate } => encode_m4a(mixed, output, bitrate),
        MixdownFormat::Mp3 { bitrate } => encode_mp3(mixed, output, bitrate),
        MixdownFormat::Flac(depth) => {
            let mut writer = FlacWriter::create(output.to, output.sample_rate, depth)?;
            for chunk in chunks {
                watch.check()?;
                for pair in chunk {
                    writer.push(pair[0], pair[1]);
                }
                watch.advance(MixdownStage::Encoding, chunk.len());
            }
            writer.finish()
        }
        MixdownFormat::Wav(depth) => {
            let mut writer = WavWriter::create(output.to, output.sample_rate, depth, frames.len())?;
            for chunk in chunks {
                watch.check()?;
                for pair in chunk {
                    writer.push(pair[0], pair[1])?;
                }
                watch.advance(MixdownStage::Encoding, chunk.len());
            }
            writer.finish()
        }
    }
}

fn encode_m4a(mixed: &[f32], output: &Output<'_>, bitrate: u32) -> Result<(), BoxedError> {
    let channels = u8::try_from(CHANNELS)?;
    let mut encoder = AacEncoder::create(output.sample_rate, channels, bitrate)?;
    encoder.push(mixed)?;
    let packets = encoder.finish()?;
    output.watch.check()?;
    let frame_count = u32::try_from(mixed.len() / CHANNELS)?;
    write_m4a(
        output.to,
        &M4aTrack {
            sample_rate: output.sample_rate,
            channels,
            packets: &packets,
            frame_count,
        },
    )
}

fn encode_mp3(mixed: &[f32], output: &Output<'_>, bitrate: u32) -> Result<(), BoxedError> {
    let mut encoder = Mp3Encoder::new(Mp3EncoderConfig {
        bitrate_kbps: bitrate / KILOBIT,
        vbr_quality: None,
    });
    for chunk in mixed.chunks(ENCODED_FRAMES * CHANNELS) {
        output.watch.check()?;
        encoder.push_pcm_f32(chunk, u16::try_from(CHANNELS)?, output.sample_rate)?;
        output
            .watch
            .advance(MixdownStage::Encoding, chunk.len() / CHANNELS);
    }
    encoder.finish();
    let mut file = BufWriter::new(File::create(output.to)?);
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
        sync::Arc,
    };

    use super::{
        Mixdown, MixdownChange, MixdownChannels, MixdownFormat, MixdownGroup, MixdownProgress,
        MixdownStage, MixdownTrack, MixdownWatch, PEAK_CEILING, STOPPED, write_mixdown,
    };
    use crate::{PcmRequest, PcmSink, PcmSource, ReadingPcm, SampleDepth, SymphoniaPcm};

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
            group: MixdownGroup::Song,
        }
    }

    #[expect(
        clippy::cast_precision_loss,
        reason = "a 24-bit sample fits the f32 mantissa"
    )]
    fn read_wav(path: &Path) -> Vec<f32> {
        let bytes = read(path).expect("the mixdown should be written");
        bytes[WAV_HEADER_BYTES..]
            .as_chunks::<3>()
            .0
            .iter()
            .map(|sample| {
                (i32::from_le_bytes([0, sample[0], sample[1], sample[2]]) >> 8) as f32 / 8_388_608.0
            })
            .collect()
    }

    struct Scene {
        frame_count: usize,
        tracks: Vec<MixdownTrack>,
        change: MixdownChange,
    }

    async fn mix(name: &str, fixture: &Fixture, tracks: Vec<MixdownTrack>) -> Vec<f32> {
        let scene = Scene {
            frame_count: 8,
            tracks,
            change: MixdownChange::ORIGINAL,
        };
        render(name, fixture, scene).await
    }

    async fn render(name: &str, fixture: &Fixture, scene: Scene) -> Vec<f32> {
        let directory =
            std::env::temp_dir().join(format!("musetric-mixdown-{name}-{}", std::process::id()));
        create_dir_all(&directory).expect("the workspace should be created");
        let to = directory.join("mix.wav");
        let mixdown = Mixdown {
            sample_rate: RATE,
            frame_count: scene.frame_count,
            tracks: scene.tracks,
            format: MixdownFormat::Wav(SampleDepth::TwentyFour),
            change: scene.change,
        };
        write_mixdown(fixture, mixdown, &to, &Arc::new(MixdownWatch::default()))
            .await
            .expect("the mixdown should be written");
        let mixed = read_wav(&to);
        remove_dir_all(&directory).expect("the workspace should be removed");
        mixed
    }

    const TONE_FRAMES: usize = 96_000;
    const TONE_AMPLITUDE: f32 = 0.5;

    async fn export_tone(name: &str, format: MixdownFormat, file: &str) -> Vec<f32> {
        let song = PathBuf::from("song.flac");
        let step = std::f32::consts::TAU * 1_000.0 / 48_000.0;
        let tone: Vec<f32> = (0..TONE_FRAMES)
            .scan(0.0_f32, |phase, _| {
                let value = phase.sin() * TONE_AMPLITUDE;
                *phase += step;
                Some([value, value])
            })
            .flatten()
            .collect();
        let fixture = Fixture(vec![(song.clone(), tone)]);
        let directory =
            std::env::temp_dir().join(format!("musetric-mixdown-{name}-{}", std::process::id()));
        create_dir_all(&directory).expect("the workspace should be created");
        let to = directory.join(file);
        let mixdown = Mixdown {
            sample_rate: RATE,
            frame_count: TONE_FRAMES,
            tracks: vec![stem(&song, 1.0)],
            format,
            change: MixdownChange::ORIGINAL,
        };
        write_mixdown(&fixture, mixdown, &to, &Arc::new(MixdownWatch::default()))
            .await
            .expect("the export should be written");
        let mut decoded = Vec::new();
        SymphoniaPcm
            .read_pcm(
                PcmRequest {
                    from: &to,
                    sample_rate: RATE,
                },
                &mut |samples| decoded.extend_from_slice(samples),
            )
            .await
            .expect("the export should decode");
        remove_dir_all(&directory).expect("the workspace should be removed");
        decoded
    }

    #[expect(
        clippy::cast_precision_loss,
        reason = "a test signal has far fewer samples than the f32 mantissa holds"
    )]
    fn rms(samples: &[f32]) -> f32 {
        (samples.iter().map(|sample| sample * sample).sum::<f32>() / samples.len() as f32).sqrt()
    }

    #[tokio::test]
    async fn exports_a_tone_that_decodes_back_from_mp3_and_m4a() {
        let formats = [
            ("mp3", MixdownFormat::Mp3 { bitrate: 192_000 }, "mix.mp3"),
            ("m4a", MixdownFormat::M4a { bitrate: 192_000 }, "mix.m4a"),
        ];
        for (name, format, file) in formats {
            let decoded = export_tone(name, format, file).await;
            let frames = decoded.len() / 2;
            assert!(
                frames.abs_diff(TONE_FRAMES) < 2_400,
                "{name} decodes to {frames} frames"
            );
            let level = rms(&decoded[19_200..decoded.len() - 19_200]);
            assert!(
                (level - TONE_AMPLITUDE * FRAC_1_SQRT_2).abs() < 0.02,
                "{name} decodes at an rms of {level}"
            );
        }
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
                group: MixdownGroup::Ready,
            },
        ];

        let mixed = mix("timeline", &fixture, tracks).await;

        for (frame, pair) in (0..8_u16).zip(mixed.as_chunks::<2>().0) {
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

    #[tokio::test]
    async fn stretches_the_song_and_lays_the_take_on_the_new_timeline() {
        let song = PathBuf::from("song.flac");
        let lead = PathBuf::from("lead.flac");
        let take = PathBuf::from("take.wav");
        let frames = 48_000_u16;
        let tone: Vec<f32> = (0..frames)
            .flat_map(|frame| {
                let value =
                    (std::f32::consts::TAU * 440.0 * f32::from(frame) / 48_000.0).sin() * 0.25;
                [value, value]
            })
            .collect();
        let fixture = Fixture(vec![
            (song.clone(), tone.clone()),
            (lead.clone(), tone),
            (take.clone(), [0.1, 0.1].repeat(100)),
        ]);
        let tracks = vec![
            stem(&song, 1.0),
            MixdownTrack {
                group: MixdownGroup::Lead,
                ..stem(&lead, 1.0)
            },
            MixdownTrack {
                from: take,
                gain: 1.0,
                channels: MixdownChannels::Mono,
                lead_in: 0,
                group: MixdownGroup::Ready,
            },
        ];
        let change = MixdownChange {
            tempo_percent: 50,
            semitones: 2,
            lead_semitones: -10,
        };

        let mixed = render(
            "stretch",
            &fixture,
            Scene {
                frame_count: usize::from(frames),
                tracks,
                change,
            },
        )
        .await;

        assert_eq!(mixed.len(), 96_000 * 2);
        let middle = &mixed[90_000..102_000];
        let power = middle.iter().map(|value| value * value).sum::<f32>() / 12_000.0;
        assert!(power > 0.01, "{power}");
        assert!(mixed[0] > 0.05, "{}", mixed[0]);
    }
    struct Stopping {
        samples: Vec<f32>,
        watch: Arc<MixdownWatch>,
    }

    impl PcmSource for Stopping {
        fn read_pcm<'source>(
            &'source self,
            _request: PcmRequest<'source>,
            sink: PcmSink<'source>,
        ) -> ReadingPcm<'source> {
            Box::pin(async move {
                sink(&self.samples);
                self.watch.stop();
                Ok(())
            })
        }
    }

    async fn stop_after_the_first_track(name: &str, scene: Scene) -> (bool, MixdownProgress) {
        let watch = Arc::new(MixdownWatch::default());
        let source = Stopping {
            samples: [0.25, -0.25].repeat(scene.frame_count),
            watch: Arc::clone(&watch),
        };
        let directory =
            std::env::temp_dir().join(format!("musetric-mixdown-{name}-{}", std::process::id()));
        create_dir_all(&directory).expect("the workspace should be created");
        let to = directory.join("mix.wav");
        let mixdown = Mixdown {
            sample_rate: RATE,
            frame_count: scene.frame_count,
            tracks: scene.tracks,
            format: MixdownFormat::Wav(SampleDepth::Sixteen),
            change: scene.change,
        };
        let written = write_mixdown(&source, mixdown, &to, &watch).await;
        assert_eq!(
            written.map_err(|failure| failure.to_string()),
            Err(STOPPED.to_owned())
        );
        let left = to.exists();
        remove_dir_all(&directory).expect("the workspace should be removed");
        (left, watch.progress())
    }

    #[tokio::test]
    async fn stops_between_the_tracks_and_inside_the_stretch_and_writes_no_file() {
        let song = PathBuf::from("song.flac");
        let backing = PathBuf::from("backing.flac");
        let mixed = stop_after_the_first_track(
            "stop-mixing",
            Scene {
                frame_count: 48_000,
                tracks: vec![stem(&song, 1.0), stem(&backing, 1.0)],
                change: MixdownChange::ORIGINAL,
            },
        )
        .await;
        assert_eq!(
            mixed,
            (
                false,
                MixdownProgress {
                    stage: MixdownStage::Mixing,
                    done: Some(0.5),
                }
            )
        );
        let stretched = stop_after_the_first_track(
            "stop-stretch",
            Scene {
                frame_count: 48_000,
                tracks: vec![stem(&song, 1.0)],
                change: MixdownChange {
                    tempo_percent: 80,
                    semitones: -2,
                    lead_semitones: -2,
                },
            },
        )
        .await;
        assert_eq!(
            stretched,
            (
                false,
                MixdownProgress {
                    stage: MixdownStage::Stretching,
                    done: Some(0.0),
                }
            )
        );
    }

    #[tokio::test]
    async fn follows_every_stage_to_its_end() {
        let song = PathBuf::from("song.flac");
        let fixture = Fixture(vec![(song.clone(), [0.1, 0.2].repeat(48_000))]);
        let directory =
            std::env::temp_dir().join(format!("musetric-mixdown-stages-{}", std::process::id()));
        create_dir_all(&directory).expect("the workspace should be created");
        for (format, done) in [
            (MixdownFormat::Flac(SampleDepth::Sixteen), Some(1.0)),
            (MixdownFormat::Mp3 { bitrate: 128_000 }, Some(1.0)),
            (MixdownFormat::M4a { bitrate: 128_000 }, None),
        ] {
            let watch = Arc::new(MixdownWatch::default());
            let mixdown = Mixdown {
                sample_rate: RATE,
                frame_count: 48_000,
                tracks: vec![stem(&song, 1.0)],
                format,
                change: MixdownChange {
                    tempo_percent: 125,
                    semitones: 1,
                    lead_semitones: 1,
                },
            };
            write_mixdown(&fixture, mixdown, &directory.join("mix"), &watch)
                .await
                .expect("the mixdown should be written");
            assert_eq!(
                watch.progress(),
                MixdownProgress {
                    stage: MixdownStage::Encoding,
                    done,
                },
                "{format:?}"
            );
        }
        remove_dir_all(&directory).expect("the workspace should be removed");
    }
}
