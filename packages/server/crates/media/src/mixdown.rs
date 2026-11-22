use std::{
    fs::File,
    io::BufWriter,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
};

use musetric_dsp::{
    aac::AacEncoder,
    flac::FlacWriter,
    m4a::{M4aTrack, write_m4a},
    mix::{add_gained, limit_peak},
    mono::Downmix,
    mp3::Mp3Encoder,
    stretch::{Refusal, Stretch},
    wav::WavWriter,
};
use tokio::task::{JoinHandle, spawn_blocking};

use crate::{
    BoxedError, MonoRequest, decode_mono_pcm,
    file::create_buffered,
    pcm::{CHANNELS, PcmRequest, PcmSource},
};

const ORIGINAL_TEMPO_PERCENT: usize = 100;
const UNIT_TEMPO_TOLERANCE: f64 = 1e-6;
const TOO_SHORT: &str = "The song is too short to change its tempo or key";
const STOPPED: &str = "The mixdown was stopped";
const ENCODED_FRAMES: usize = 65_536;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MixdownFormat {
    M4a { bitrate: u32 },
    Mp3 { bitrate: u32 },
    Flac,
    Wav,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MixdownGroup {
    Song,
    Lead,
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
            MixdownGroup::Song => self.semitones,
        }
    }
}

pub struct MixdownTrack {
    pub from: PathBuf,
    pub gain: f32,
    pub group: MixdownGroup,
}

pub struct MixdownTake {
    pub from: PathBuf,
    pub gain: f32,
    pub sample_rate: u32,
    pub song_start_frame: usize,
    pub tempo: f64,
    pub semitones: i32,
}

pub struct Mixdown {
    pub sample_rate: u32,
    pub frame_count: usize,
    pub tracks: Vec<MixdownTrack>,
    pub takes: Vec<MixdownTake>,
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
    abandoned: AtomicBool,
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

    fn abandon(&self) {
        self.abandoned.store(true, Ordering::Relaxed);
    }

    fn going(&self) -> bool {
        !self.stopped() && !self.abandoned.load(Ordering::Relaxed)
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
    let written = mix(source, mixdown, to, watch).await;
    if written.is_err() {
        watch.abandon();
    }
    written
}

async fn mix(
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
        stretching.push(spawn_stretch(stretch, deinterleave(&song), watch));
    }
    let takes = render_takes(reading, &mixdown, frame_count, watch).await?;
    if !stretching.is_empty() || takes.iter().any(TakeRender::stretched) {
        watch.enter(MixdownStage::Stretching);
    }
    add_stretched(stretching, &mut mixed).await?;
    add_takes(takes, &mut mixed).await?;
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

fn spawn_stretch(
    stretch: Stretch,
    channels: Vec<Vec<f32>>,
    watch: &Arc<MixdownWatch>,
) -> Stretching {
    let stretching = Arc::clone(watch);
    watch.plan(MixdownStage::Stretching, stretch.frame_count);
    spawn_blocking(move || {
        let mut reported = 0;
        stretch.apply(&channels, &mut |written| {
            stretching.advance(MixdownStage::Stretching, written - reported);
            reported = written;
            stretching.going()
        })
    })
}

async fn stretched(task: Stretching) -> Result<Vec<Vec<f32>>, BoxedError> {
    Ok(task.await?.map_err(|refusal| match refusal {
        Refusal::TooShort => TOO_SHORT,
        Refusal::Stopped => STOPPED,
    })?)
}

async fn add_stretched(stretching: Vec<Stretching>, mixed: &mut [f32]) -> Result<(), BoxedError> {
    for task in stretching {
        let channels = stretched(task).await?;
        for (frame, pair) in mixed.as_chunks_mut::<CHANNELS>().0.iter_mut().enumerate() {
            pair[0] += channels[0][frame];
            pair[1] += channels[1][frame];
        }
    }
    Ok(())
}

enum TakeSamples {
    Kept(Vec<f32>),
    Stretched(Stretching),
}

struct TakeRender {
    start: usize,
    length: usize,
    gain: f32,
    samples: TakeSamples,
}

impl TakeRender {
    const fn stretched(&self) -> bool {
        matches!(self.samples, TakeSamples::Stretched(_))
    }
}

#[expect(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "frame counts of a song fit the f64 mantissa and a scaled count is not negative"
)]
fn scaled(frames: usize, numerator: f64, denominator: f64) -> usize {
    (frames as f64 * numerator / denominator).round() as usize
}

#[expect(
    clippy::cast_precision_loss,
    reason = "tempo percents are small integers"
)]
fn tempo_ratio(change: MixdownChange) -> f64 {
    change.tempo_percent as f64 / ORIGINAL_TEMPO_PERCENT as f64
}

async fn read_take(reading: Reading<'_>, take: &MixdownTake) -> Result<Vec<f32>, BoxedError> {
    let bytes = decode_mono_pcm(MonoRequest {
        source: reading.source,
        request: PcmRequest {
            from: &take.from,
            sample_rate: reading.sample_rate,
        },
        downmix: Downmix::Power,
        decoded: &mut |_| {},
    })
    .await?;
    Ok(bytes
        .as_chunks::<{ size_of::<f32>() }>()
        .0
        .iter()
        .map(|value| f32::from_le_bytes(*value))
        .collect())
}

async fn render_takes(
    reading: Reading<'_>,
    mixdown: &Mixdown,
    frame_count: usize,
    watch: &Arc<MixdownWatch>,
) -> Result<Vec<TakeRender>, BoxedError> {
    let tempo = tempo_ratio(mixdown.change);
    let shortest = usize::try_from(mixdown.sample_rate)?;
    let mut renders = Vec::with_capacity(mixdown.takes.len());
    for take in &mixdown.takes {
        reading.watch.check()?;
        let start = scaled(
            take.song_start_frame,
            f64::from(mixdown.sample_rate),
            f64::from(take.sample_rate) * tempo,
        );
        if start >= frame_count {
            continue;
        }
        let mut samples = read_take(reading, take).await?;
        let ratio = tempo / take.tempo;
        if (ratio - 1.0).abs() < UNIT_TEMPO_TOLERANCE && take.semitones == 0 {
            renders.push(TakeRender {
                start,
                length: samples.len(),
                gain: take.gain,
                samples: TakeSamples::Kept(samples),
            });
            continue;
        }
        let length = scaled(samples.len(), 1.0, ratio);
        samples.resize(samples.len().max(shortest), 0.0);
        let stretch = Stretch {
            sample_rate: mixdown.sample_rate,
            frame_count: scaled(samples.len(), 1.0, ratio),
            semitones: take.semitones,
            keep_formants: false,
        };
        renders.push(TakeRender {
            start,
            length,
            gain: take.gain,
            samples: TakeSamples::Stretched(spawn_stretch(stretch, vec![samples], watch)),
        });
    }
    Ok(renders)
}

async fn add_takes(renders: Vec<TakeRender>, mixed: &mut [f32]) -> Result<(), BoxedError> {
    if renders.is_empty() {
        return Ok(());
    }
    let mut sung = vec![0.0_f32; mixed.len() / CHANNELS];
    for render in renders {
        let samples = match render.samples {
            TakeSamples::Kept(samples) => samples,
            TakeSamples::Stretched(task) => stretched(task).await?.swap_remove(0),
        };
        for (slot, sample) in sung[render.start..]
            .iter_mut()
            .zip(&samples[..render.length])
        {
            *slot = sample * render.gain;
        }
    }
    for (pair, sample) in mixed.as_chunks_mut::<CHANNELS>().0.iter_mut().zip(&sung) {
        pair[0] += sample;
        pair[1] += sample;
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
    let mut sample = 0_usize;
    let mut sink = |chunk: &[f32]| {
        let whole = chunk.len() / CHANNELS * CHANNELS;
        let start = sample.min(mixed.len());
        let end = (sample + whole).min(mixed.len());
        add_gained(&mut mixed[start..end], &chunk[..end - start], track.gain);
        sample += whole;
    };
    reading.source.read_pcm(request, &mut sink).await?;
    reading.watch.advance(MixdownStage::Mixing, 1);
    Ok(())
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
        MixdownFormat::Flac => {
            let mut writer = FlacWriter::create(create_buffered(output.to)?, output.sample_rate)?;
            for chunk in chunks {
                watch.check()?;
                for pair in chunk {
                    writer.push(pair[0], pair[1]);
                }
                watch.advance(MixdownStage::Encoding, chunk.len());
            }
            writer.finish()?;
            Ok(())
        }
        MixdownFormat::Wav => {
            let mut writer = WavWriter::create(
                create_buffered(output.to)?,
                output.sample_rate,
                frames.len(),
            )?;
            for chunk in chunks {
                watch.check()?;
                for pair in chunk {
                    writer.push(pair[0], pair[1])?;
                }
                watch.advance(MixdownStage::Encoding, chunk.len());
            }
            writer.finish()?;
            Ok(())
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
        BufWriter::new(File::create(output.to)?),
        &M4aTrack {
            sample_rate: output.sample_rate,
            channels,
            packets: &packets,
            frame_count,
        },
    )?;
    Ok(())
}

fn encode_mp3(mixed: &[f32], output: &Output<'_>, bitrate: u32) -> Result<(), BoxedError> {
    let mut encoder = Mp3Encoder::create(output.sample_rate, bitrate);
    for chunk in mixed.chunks(ENCODED_FRAMES * CHANNELS) {
        output.watch.check()?;
        encoder.push(chunk)?;
        output
            .watch
            .advance(MixdownStage::Encoding, chunk.len() / CHANNELS);
    }
    encoder.finish(BufWriter::new(File::create(output.to)?))?;
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
        Mixdown, MixdownChange, MixdownFormat, MixdownGroup, MixdownProgress, MixdownStage,
        MixdownTake, MixdownTrack, MixdownWatch, STOPPED, write_mixdown,
    };
    use musetric_dsp::mix::PEAK_CEILING;

    use crate::{PcmRequest, PcmSink, PcmSource, ReadingPcm, SymphoniaPcm};

    const RATE: u32 = 48_000;
    const WAV_HEADER_BYTES: usize = 44;
    const TOLERANCE: f32 = 1e-4;

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
                .map_or_default(|(_, samples)| samples.clone());
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
            group: MixdownGroup::Song,
        }
    }

    fn take(from: &Path, song_start_frame: usize, tempo: f64) -> MixdownTake {
        MixdownTake {
            from: from.to_owned(),
            gain: 1.0,
            sample_rate: RATE,
            song_start_frame,
            tempo,
            semitones: 0,
        }
    }

    fn mono(samples: &[f32]) -> Vec<f32> {
        samples
            .iter()
            .flat_map(|sample| [sample * FRAC_1_SQRT_2; 2])
            .collect()
    }

    fn read_wav(path: &Path) -> Vec<f32> {
        let bytes = read(path).expect("the mixdown should be written");
        bytes[WAV_HEADER_BYTES..]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|sample| f32::from(i16::from_le_bytes(*sample)) / 32_768.0)
            .collect()
    }

    struct Scene {
        frame_count: usize,
        tracks: Vec<MixdownTrack>,
        takes: Vec<MixdownTake>,
        change: MixdownChange,
    }

    async fn mix(name: &str, fixture: &Fixture, tracks: Vec<MixdownTrack>) -> Vec<f32> {
        let scene = Scene {
            frame_count: 8,
            tracks,
            takes: Vec::new(),
            change: MixdownChange::ORIGINAL,
        };
        render(name, fixture, scene).await
    }

    fn workspace(name: &str) -> PathBuf {
        let directory =
            std::env::temp_dir().join(format!("musetric-mixdown-{name}-{}", std::process::id()));
        create_dir_all(&directory).expect("the workspace should be created");
        directory
    }

    fn wav_mixdown(scene: Scene) -> Mixdown {
        Mixdown {
            sample_rate: RATE,
            frame_count: scene.frame_count,
            tracks: scene.tracks,
            takes: scene.takes,
            format: MixdownFormat::Wav,
            change: scene.change,
        }
    }

    async fn render(name: &str, fixture: &Fixture, scene: Scene) -> Vec<f32> {
        let directory = workspace(name);
        let to = directory.join("mix.wav");
        let mixdown = wav_mixdown(scene);
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
            takes: Vec::new(),
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
        let recorded = PathBuf::from("take.wav");
        let take_frames: Vec<f32> = (0..12_u16).map(|frame| f32::from(frame) * 0.01).collect();
        let fixture = Fixture(vec![
            (instrumental.clone(), [0.1, 0.2].repeat(8)),
            (recorded.clone(), mono(&take_frames)),
        ]);
        let scene = Scene {
            frame_count: 8,
            tracks: vec![stem(&instrumental, 0.5)],
            takes: vec![MixdownTake {
                gain: 2.0,
                ..take(&recorded, 0, 1.0)
            }],
            change: MixdownChange::ORIGINAL,
        };

        let mixed = render("timeline", &fixture, scene).await;

        for (frame, pair) in (0..8_u16).zip(mixed.as_chunks::<2>().0) {
            let sung = 0.02 * f32::from(frame);
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
    async fn lays_a_take_of_another_rate_at_its_frame_on_the_new_timeline() {
        let sung = PathBuf::from("take.wav");
        let fixture = Fixture(vec![(sung.clone(), mono(&[0.5; 4]))]);
        let scene = Scene {
            frame_count: 16,
            tracks: Vec::new(),
            takes: vec![MixdownTake {
                sample_rate: RATE / 2,
                ..take(&sung, 2, 0.5)
            }],
            change: MixdownChange {
                tempo_percent: 50,
                ..MixdownChange::ORIGINAL
            },
        };

        let mixed = render("take-frame", &fixture, scene).await;

        let left: Vec<f32> = mixed.iter().step_by(2).copied().collect();
        let expected: Vec<f32> = (0..32)
            .map(|frame| if (8..12).contains(&frame) { 0.5 } else { 0.0 })
            .collect();
        for (frame, (value, wanted)) in left.iter().zip(&expected).enumerate() {
            assert!((value - wanted).abs() < TOLERANCE, "{frame}: {value}");
        }
        assert_eq!(left.len(), expected.len());
    }

    #[tokio::test]
    async fn lays_a_later_take_over_an_earlier_one() {
        let first = PathBuf::from("first.wav");
        let second = PathBuf::from("second.wav");
        let fixture = Fixture(vec![
            (first.clone(), mono(&[0.2; 6])),
            (second.clone(), mono(&[0.4; 2])),
        ]);
        let scene = Scene {
            frame_count: 8,
            tracks: Vec::new(),
            takes: vec![take(&first, 0, 1.0), take(&second, 2, 1.0)],
            change: MixdownChange::ORIGINAL,
        };

        let mixed = render("take-order", &fixture, scene).await;

        let left: Vec<f32> = mixed.iter().step_by(2).copied().collect();
        for (frame, (value, expected)) in left
            .iter()
            .zip([0.2, 0.2, 0.4, 0.4, 0.2, 0.2, 0.0, 0.0])
            .enumerate()
        {
            assert!((value - expected).abs() < TOLERANCE, "{frame}: {value}");
        }
    }

    #[tokio::test]
    async fn stretches_a_short_take_recorded_at_another_tempo() {
        let sung = PathBuf::from("take.wav");
        let tone: Vec<f32> = (0..24_000_u16)
            .map(|frame| (std::f32::consts::TAU * 440.0 * f32::from(frame) / 48_000.0).sin() * 0.25)
            .collect();
        let fixture = Fixture(vec![(sung.clone(), mono(&tone))]);
        let scene = Scene {
            frame_count: 48_000,
            tracks: Vec::new(),
            takes: vec![MixdownTake {
                semitones: 2,
                ..take(&sung, 12_000, 1.0)
            }],
            change: MixdownChange {
                tempo_percent: 50,
                ..MixdownChange::ORIGINAL
            },
        };

        let mixed = render("take-stretch", &fixture, scene).await;

        let left: Vec<f32> = mixed.iter().step_by(2).copied().collect();
        assert_eq!(left.len(), 96_000);
        assert!(left[..24_000].iter().all(|value| *value == 0.0));
        assert!(left[72_000..].iter().all(|value| *value == 0.0));
        let power = left[30_000..66_000]
            .iter()
            .map(|value| value * value)
            .sum::<f32>()
            / 36_000.0;
        assert!(power > 0.01, "{power}");
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
    async fn stretches_the_song_and_the_lead_onto_the_new_timeline() {
        let song = PathBuf::from("song.flac");
        let lead = PathBuf::from("lead.flac");
        let frames = 48_000_u16;
        let tone: Vec<f32> = (0..frames)
            .flat_map(|frame| {
                let value =
                    (std::f32::consts::TAU * 440.0 * f32::from(frame) / 48_000.0).sin() * 0.25;
                [value, value]
            })
            .collect();
        let fixture = Fixture(vec![(song.clone(), tone.clone()), (lead.clone(), tone)]);
        let tracks = vec![
            stem(&song, 1.0),
            MixdownTrack {
                group: MixdownGroup::Lead,
                ..stem(&lead, 1.0)
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
                takes: Vec::new(),
                change,
            },
        )
        .await;

        assert_eq!(mixed.len(), 96_000 * 2);
        let middle = &mixed[90_000..102_000];
        let power = middle.iter().map(|value| value * value).sum::<f32>() / 12_000.0;
        assert!(power > 0.01, "{power}");
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
        let directory = workspace(name);
        let to = directory.join("mix.wav");
        let mixdown = wav_mixdown(scene);
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
                takes: Vec::new(),
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
                takes: Vec::new(),
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
            (MixdownFormat::Flac, Some(1.0)),
            (MixdownFormat::Mp3 { bitrate: 128_000 }, Some(1.0)),
            (MixdownFormat::M4a { bitrate: 128_000 }, None),
        ] {
            let watch = Arc::new(MixdownWatch::default());
            let mixdown = Mixdown {
                sample_rate: RATE,
                frame_count: 48_000,
                tracks: vec![stem(&song, 1.0)],
                takes: Vec::new(),
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
    struct FailingLead;

    impl PcmSource for FailingLead {
        fn read_pcm<'source>(
            &'source self,
            request: PcmRequest<'source>,
            sink: PcmSink<'source>,
        ) -> ReadingPcm<'source> {
            let lead = request.from == Path::new("lead.flac");
            let samples = if lead {
                Vec::new()
            } else {
                [0.25, -0.25].repeat(48_000)
            };
            let outcome: Result<(), crate::BoxedError> = if lead {
                Err("the lead stem cannot be read".into())
            } else {
                Ok(())
            };
            Box::pin(async move {
                sink(&samples);
                outcome
            })
        }
    }

    #[tokio::test]
    async fn lets_the_stretches_go_when_a_track_fails_and_keeps_the_failure() {
        let song = PathBuf::from("song.flac");
        let lead = PathBuf::from("lead.flac");
        let watch = Arc::new(MixdownWatch::default());
        let mixdown = Mixdown {
            sample_rate: RATE,
            frame_count: 48_000,
            tracks: vec![
                stem(&song, 1.0),
                MixdownTrack {
                    group: MixdownGroup::Lead,
                    ..stem(&lead, 1.0)
                },
            ],
            takes: Vec::new(),
            format: MixdownFormat::Wav,
            change: MixdownChange {
                tempo_percent: 80,
                semitones: -2,
                lead_semitones: 10,
            },
        };
        let written = write_mixdown(
            &FailingLead,
            mixdown,
            &std::env::temp_dir().join("musetric-mixdown-failing.wav"),
            &watch,
        )
        .await;
        assert_eq!(
            written.map_err(|failure| failure.to_string()),
            Err("the lead stem cannot be read".to_owned())
        );
        assert!(!watch.going());
        assert!(!watch.stopped());
    }
}
