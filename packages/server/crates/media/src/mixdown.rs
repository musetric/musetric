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
    mix::limit_peak,
    mono::Downmix,
    mp3::Mp3Encoder,
    render::{
        LEAD, Parts, Piece, STEM_COUNT, Song, StemLayout, StemPages, Target, render_song, stretches,
    },
    wav::WavWriter,
};
use tokio::task::{JoinHandle, spawn_blocking};

use crate::{
    BoxedError, MonoRequest, decode_mono_pcm,
    file::create_buffered,
    pcm::{CHANNELS, PcmChunks, PcmRequest, PcmSource},
};

const ORIGINAL_TEMPO_PERCENT: usize = 100;
const STOPPED: &str = "The mixdown was stopped";
const NO_STEM: &str = "The mixdown reads no such stem";
const OUT_OF_ORDER: &str = "A stem is read page after page";
const ENCODED_FRAMES: usize = 65_536;
const PAGE_FRAMES: usize = 65_536;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MixdownFormat {
    M4a { bitrate: u32 },
    Mp3 { bitrate: u32 },
    Flac,
    Wav,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MixdownChange {
    pub tempo_percent: usize,
    pub semitones: i32,
    pub voice_octave: Option<i32>,
}

impl MixdownChange {
    pub const ORIGINAL: Self = Self {
        tempo_percent: ORIGINAL_TEMPO_PERCENT,
        semitones: 0,
        voice_octave: None,
    };

    #[must_use]
    pub const fn frame_count(self, source_frames: usize) -> usize {
        (source_frames * ORIGINAL_TEMPO_PERCENT + self.tempo_percent / 2) / self.tempo_percent
    }

    #[must_use]
    pub const fn lead_apart(self) -> bool {
        matches!(self.voice_octave, Some(octave) if octave != 0)
    }

    #[expect(
        clippy::cast_precision_loss,
        reason = "tempo percents are small integers"
    )]
    fn target(self) -> Target {
        Target {
            tempo: self.tempo_percent as f64 / ORIGINAL_TEMPO_PERCENT as f64,
            transpose: self.semitones,
            voice_octave: self.voice_octave.unwrap_or(0),
            voice_shifted: self.voice_octave.is_some(),
        }
    }
}

pub struct MixdownTrack {
    pub from: PathBuf,
    pub gain: f32,
}

pub struct MixdownTake {
    pub from: PathBuf,
    pub sample_rate: u32,
    pub song_start_frame: usize,
    pub tempo: f64,
    pub transpose: i32,
    pub octave: i32,
}

pub struct Mixdown {
    pub sample_rate: u32,
    pub frame_count: usize,
    pub stems: [Option<MixdownTrack>; STEM_COUNT],
    pub takes: Vec<MixdownTake>,
    pub take_gain: f32,
    pub format: MixdownFormat,
    pub change: MixdownChange,
}

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

struct Output<'mixdown> {
    sample_rate: u32,
    format: MixdownFormat,
    to: &'mixdown Path,
    watch: &'mixdown MixdownWatch,
}

struct StreamedStem {
    chunks: PcmChunks,
    carry: Vec<f32>,
    next: usize,
}

impl StreamedStem {
    fn page(&mut self, index: usize, frames: usize) -> Result<Vec<f32>, BoxedError> {
        if index != self.next {
            return Err(OUT_OF_ORDER.into());
        }
        self.next += 1;
        let wanted = frames * CHANNELS;
        while self.carry.len() < wanted {
            match self.chunks.recv() {
                Ok(chunk) => self.carry.extend_from_slice(&chunk?),
                Err(_) => break,
            }
        }
        let taken = wanted.min(self.carry.len());
        let mut interleaved: Vec<f32> = self.carry.drain(..taken).collect();
        interleaved.resize(wanted, 0.0);
        Ok((0..CHANNELS)
            .flat_map(|channel| interleaved.iter().skip(channel).step_by(CHANNELS).copied())
            .collect())
    }
}

struct Streams {
    frame_count: usize,
    stems: Vec<Option<StreamedStem>>,
}

impl Streams {
    fn open(source: &dyn PcmSource, mixdown: &Mixdown, mask: u32) -> Result<Self, BoxedError> {
        let mut stems = Vec::with_capacity(STEM_COUNT);
        for (stem, track) in mixdown.stems.iter().enumerate() {
            let read = track.as_ref().filter(|_| mask & (1 << stem) != 0);
            stems.push(match read {
                Some(opened) => Some(StreamedStem {
                    chunks: source.stream_pcm(PcmRequest {
                        from: &opened.from,
                        sample_rate: mixdown.sample_rate,
                    })?,
                    carry: Vec::new(),
                    next: 0,
                }),
                None => None,
            });
        }
        Ok(Self {
            frame_count: mixdown.frame_count,
            stems,
        })
    }

    fn page_frames(&self, index: usize) -> usize {
        PAGE_FRAMES.min(self.frame_count.saturating_sub(index * PAGE_FRAMES))
    }
}

impl StemPages for Streams {
    fn layout(&self, stem: usize) -> StemLayout {
        if self.stems.get(stem).is_none_or(Option::is_none) {
            return StemLayout {
                frame_count: 0,
                page_starts: Vec::new(),
            };
        }
        StemLayout {
            frame_count: i64::try_from(self.frame_count).unwrap_or(i64::MAX),
            page_starts: (0..self.frame_count)
                .step_by(PAGE_FRAMES)
                .map(|start| i64::try_from(start).unwrap_or(i64::MAX))
                .collect(),
        }
    }

    fn read(&mut self, stem: usize, index: usize) -> Result<Vec<f32>, BoxedError> {
        let frames = self.page_frames(index);
        self.stems
            .get_mut(stem)
            .and_then(Option::as_mut)
            .ok_or(NO_STEM)?
            .page(index, frames)
    }
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

struct Rendering {
    streams: Streams,
    song: Song,
    parts: Parts,
    reported: Option<MixdownStage>,
}

fn spawn_render(
    rendering: Rendering,
    watch: &Arc<MixdownWatch>,
) -> JoinHandle<Result<Option<Vec<f32>>, BoxedError>> {
    let shared = Arc::clone(watch);
    spawn_blocking(move || {
        let Rendering {
            mut streams,
            song,
            parts,
            reported,
        } = rendering;
        let mut done = 0;
        let outcome = render_song(&mut streams, &song, parts, &mut |written| {
            if let Some(stage) = reported {
                shared.advance(stage, written - done);
                done = written;
            }
            shared.going()
        });
        if outcome.is_err() {
            shared.abandon();
        }
        outcome
    })
}

async fn rendered(
    task: JoinHandle<Result<Option<Vec<f32>>, BoxedError>>,
    watch: &MixdownWatch,
) -> Result<Vec<f32>, BoxedError> {
    let outcome = task.await?;
    if outcome.is_err() {
        watch.abandon();
    }
    outcome?.ok_or_else(|| STOPPED.into())
}

#[expect(
    clippy::cast_precision_loss,
    reason = "the frames of a song and the rates of audio are far below the f64 mantissa"
)]
fn song_frame(take: &MixdownTake, sample_rate: u32) -> f64 {
    take.song_start_frame as f64 * f64::from(sample_rate) / f64::from(take.sample_rate)
}

async fn read_pieces(
    source: &dyn PcmSource,
    mixdown: &Mixdown,
    watch: &MixdownWatch,
) -> Result<Vec<Piece>, BoxedError> {
    let mut pieces = Vec::with_capacity(mixdown.takes.len());
    for take in &mixdown.takes {
        watch.check()?;
        let bytes = decode_mono_pcm(MonoRequest {
            source,
            request: PcmRequest {
                from: &take.from,
                sample_rate: mixdown.sample_rate,
            },
            downmix: Downmix::Power,
            decoded: &mut |_| {},
        })
        .await?;
        pieces.push(Piece {
            song_start: song_frame(take, mixdown.sample_rate),
            tempo: take.tempo,
            transpose: take.transpose,
            octave: take.octave,
            samples: bytes
                .as_chunks::<{ size_of::<f32>() }>()
                .0
                .iter()
                .map(|value| f32::from_le_bytes(*value))
                .collect(),
        });
    }
    Ok(pieces)
}

fn add_part(
    sum: Result<Vec<f32>, BoxedError>,
    part: Result<Vec<f32>, BoxedError>,
) -> Result<Vec<f32>, BoxedError> {
    match (sum, part) {
        (Ok(mut mixed), Ok(added)) if added.len() == mixed.len() => {
            for (sample, value) in mixed.iter_mut().zip(added) {
                *sample += value;
            }
            Ok(mixed)
        }
        (Ok(mut mixed), Ok(added)) => {
            for (frame, value) in mixed.as_chunks_mut::<CHANNELS>().0.iter_mut().zip(added) {
                for sample in frame {
                    *sample += value;
                }
            }
            Ok(mixed)
        }
        (Err(failure), Ok(_)) | (Ok(_), Err(failure)) => Err(failure),
        (Err(sum_failure), Err(part_failure)) => Err(if sum_failure.to_string() == STOPPED {
            part_failure
        } else {
            sum_failure
        }),
    }
}

async fn mix(
    source: &dyn PcmSource,
    mixdown: Mixdown,
    to: &Path,
    watch: &Arc<MixdownWatch>,
) -> Result<(), BoxedError> {
    let pieces = read_pieces(source, &mixdown, watch).await?;
    let target = mixdown.change.target();
    let frames = mixdown.change.frame_count(mixdown.frame_count);
    let stage = if stretches(target, &pieces) {
        MixdownStage::Stretching
    } else {
        MixdownStage::Mixing
    };
    watch.plan(stage, frames);
    watch.enter(stage);
    let lead_apart = mixdown.change.lead_apart();
    let song = Song {
        sample_rate: mixdown.sample_rate,
        frame_count: frames,
        volumes: mixdown
            .stems
            .each_ref()
            .map(|track| track.as_ref().map_or(0.0, |found| found.gain)),
        target,
        recording_volume: mixdown.take_gain,
        pieces,
    };
    let mut sides = Vec::new();
    for (parts, stems, used) in [
        (Parts::TAKES, 0, !song.pieces.is_empty()),
        (Parts::LEAD, LEAD, lead_apart),
    ] {
        if used {
            let rendering = Rendering {
                streams: Streams::open(source, &mixdown, stems)?,
                song: song.clone(),
                parts,
                reported: None,
            };
            sides.push(spawn_render(rendering, watch));
        }
    }
    let rendering = Rendering {
        streams: Streams::open(source, &mixdown, if lead_apart { !LEAD } else { u32::MAX })?,
        song,
        parts: Parts::SONG,
        reported: Some(stage),
    };
    let mut summed = rendered(spawn_render(rendering, watch), watch).await;
    for side in sides {
        summed = add_part(summed, rendered(side, watch).await);
    }
    let mut mixed = summed?;
    limit_peak(&mut mixed);
    let target_path = to.to_owned();
    let encoding = Arc::clone(watch);
    spawn_blocking(move || {
        encode(
            &mixed,
            &Output {
                sample_rate: mixdown.sample_rate,
                format: mixdown.format,
                to: &target_path,
                watch: &encoding,
            },
        )
    })
    .await?
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
        sync::{Arc, mpsc::channel},
    };

    use super::{
        Mixdown, MixdownChange, MixdownFormat, MixdownProgress, MixdownStage, MixdownTake,
        MixdownTrack, MixdownWatch, write_mixdown,
    };
    use musetric_dsp::mix::PEAK_CEILING;

    use crate::{BoxedError, PcmChunks, PcmRequest, PcmSink, PcmSource, ReadingPcm, SymphoniaPcm};

    fn chunks(samples: Result<Vec<f32>, BoxedError>) -> PcmChunks {
        let (sent, received) = channel();
        sent.send(samples).ok();
        received
    }

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

        fn stream_pcm(&self, request: PcmRequest<'_>) -> Result<PcmChunks, BoxedError> {
            let found = self
                .0
                .iter()
                .find(|(path, _)| path == request.from)
                .map_or_default(|(_, samples)| samples.clone());
            Ok(chunks(Ok(found)))
        }
    }

    fn stem(from: &Path, gain: f32) -> MixdownTrack {
        MixdownTrack {
            from: from.to_owned(),
            gain,
        }
    }

    fn take(from: &Path, song_start_frame: usize, tempo: f64) -> MixdownTake {
        MixdownTake {
            from: from.to_owned(),
            sample_rate: RATE,
            song_start_frame,
            tempo,
            transpose: 0,
            octave: 0,
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

    type Stems = [Option<MixdownTrack>; 3];

    struct Scene {
        frame_count: usize,
        stems: Stems,
        takes: Vec<MixdownTake>,
        take_gain: f32,
        change: MixdownChange,
    }

    async fn mix(name: &str, fixture: &Fixture, stems: Stems) -> Vec<f32> {
        let scene = Scene {
            frame_count: 8,
            stems,
            takes: Vec::new(),
            take_gain: 1.0,
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
            stems: scene.stems,
            takes: scene.takes,
            take_gain: scene.take_gain,
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
            take_gain: 1.0,
            stems: [None, None, Some(stem(&song, 1.0))],
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
            stems: [None, None, Some(stem(&instrumental, 0.5))],
            takes: vec![take(&recorded, 0, 1.0)],
            take_gain: 2.0,
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
            stems: [None, None, None],
            takes: vec![MixdownTake {
                sample_rate: RATE / 2,
                ..take(&sung, 2, 0.5)
            }],
            take_gain: 1.0,
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
            stems: [None, None, None],
            takes: vec![take(&first, 0, 1.0), take(&second, 2, 1.0)],
            take_gain: 1.0,
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
            stems: [None, None, None],
            takes: vec![MixdownTake {
                transpose: -2,
                ..take(&sung, 12_000, 1.0)
            }],
            take_gain: 1.0,
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
            [Some(stem(&lead, 1.0)), Some(stem(&backing, 1.0)), None],
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
        let stems = [Some(stem(&lead, 1.0)), None, Some(stem(&song, 1.0))];
        let change = MixdownChange {
            tempo_percent: 50,
            semitones: 2,
            voice_octave: Some(-1),
        };

        let mixed = render(
            "stretch",
            &fixture,
            Scene {
                frame_count: usize::from(frames),
                stems,
                takes: Vec::new(),
                take_gain: 1.0,
                change,
            },
        )
        .await;

        assert_eq!(mixed.len(), 96_000 * 2);
        let middle = &mixed[90_000..102_000];
        let power = middle.iter().map(|value| value * value).sum::<f32>() / 12_000.0;
        assert!(power > 0.01, "{power}");
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
                stems: [None, None, Some(stem(&song, 1.0))],
                takes: Vec::new(),
                take_gain: 1.0,
                format,
                change: MixdownChange {
                    tempo_percent: 125,
                    semitones: 1,
                    voice_octave: None,
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
