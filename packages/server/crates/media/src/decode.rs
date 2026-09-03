use std::{
    f32::consts::FRAC_1_SQRT_2,
    ffi::OsStr,
    fs::File,
    path::{Path, PathBuf},
};

use symphonia::core::{
    audio::{Channels, GenericAudioBufferRef, Position},
    codecs::audio::{AudioDecoder, AudioDecoderOptions},
    errors::Error,
    formats::{FormatOptions, FormatReader, TrackType, probe::Hint},
    io::{MediaSourceStream, MediaSourceStreamOptions},
    meta::MetadataOptions,
    packet::Packet,
};
use tokio::{sync::mpsc, task::spawn_blocking};

use crate::{
    pcm::{PcmRequest, PcmSink, PcmSource, ReadingPcm},
    resample::{Conversion, SampleRates},
    run::BoxedError,
};

const QUEUE_DEPTH: usize = 8;
const POWER_WEIGHT: f32 = FRAC_1_SQRT_2;
const NO_TRACK: &str = "The file carries no audio track";
const NO_PARAMETERS: &str = "The audio track declares no codec parameters";
const NO_SAMPLE_RATE: &str = "The audio track declares no sample rate";
const NO_CHANNELS: &str = "The audio track declares no channels";

pub struct SymphoniaPcm;

impl PcmSource for SymphoniaPcm {
    fn read_pcm<'source>(
        &'source self,
        request: PcmRequest<'source>,
        sink: PcmSink<'source>,
    ) -> ReadingPcm<'source> {
        Box::pin(read(request.from.to_owned(), request.sample_rate, sink))
    }
}

async fn read(from: PathBuf, sample_rate: u32, sink: PcmSink<'_>) -> Result<(), BoxedError> {
    let (produced, mut ready) = mpsc::channel(QUEUE_DEPTH);
    let decoding = spawn_blocking(move || decode(&from, sample_rate, &produced));
    while let Some(chunk) = ready.recv().await {
        sink(&chunk);
    }
    decoding.await?
}

struct Track {
    reader: Box<dyn FormatReader>,
    decoder: Box<dyn AudioDecoder>,
    id: u32,
    fold: Fold,
    sample_rate: u32,
}

fn decode(
    from: &Path,
    sample_rate: u32,
    produced: &mpsc::Sender<Vec<f32>>,
) -> Result<(), BoxedError> {
    let mut track = open(from)?;
    let rates = SampleRates {
        input: track.sample_rate,
        output: sample_rate,
    };
    let mut conversion = Conversion::create(rates)?;
    let mut interleaved = Vec::new();
    let mut read_frames = 0_usize;
    while let Some(packet) = next_packet(track.reader.as_mut())? {
        if packet.track_id != track.id {
            continue;
        }
        let Some(buffer) = decode_packet(track.decoder.as_mut(), &packet)? else {
            continue;
        };
        read_frames += buffer.frames();
        buffer.copy_to_vec_interleaved(&mut interleaved);
        let frames = track.fold.apply(&interleaved);
        send(produced, conversion.convert(frames)?)?;
    }
    send(produced, conversion.flush(read_frames)?)
}

fn open(from: &Path) -> Result<Track, BoxedError> {
    let reader = probe(from)?;
    let track = reader
        .default_track(TrackType::Audio)
        .ok_or(BoxedError::from(NO_TRACK))?;
    let id = track.id;
    let parameters = track
        .codec_params
        .as_ref()
        .and_then(|found| found.audio())
        .ok_or(BoxedError::from(NO_PARAMETERS))?;
    let sample_rate = parameters
        .sample_rate
        .ok_or(BoxedError::from(NO_SAMPLE_RATE))?;
    let channels = parameters
        .channels
        .clone()
        .filter(|found| found.count() > 0)
        .ok_or(BoxedError::from(NO_CHANNELS))?;
    let decoder = symphonia::default::get_codecs()
        .make_audio_decoder(parameters, &AudioDecoderOptions::default())?;
    Ok(Track {
        reader,
        decoder,
        id,
        fold: Fold::create(&channels),
        sample_rate,
    })
}

fn probe(from: &Path) -> Result<Box<dyn FormatReader>, BoxedError> {
    let file = File::open(from)?;
    let stream = MediaSourceStream::new(Box::new(file), MediaSourceStreamOptions::default());
    let mut hint = Hint::new();
    if let Some(extension) = from.extension().and_then(OsStr::to_str) {
        hint.with_extension(extension);
    }
    let reader = symphonia::default::get_probe().probe(
        &hint,
        stream,
        FormatOptions::default(),
        MetadataOptions::default(),
    )?;
    Ok(reader)
}

fn next_packet(reader: &mut dyn FormatReader) -> Result<Option<Packet>, BoxedError> {
    match reader.next_packet() {
        Ok(packet) => Ok(packet),
        Err(Error::ResetRequired) => Ok(None),
        Err(failure) => Err(failure.into()),
    }
}

fn decode_packet<'decoder>(
    decoder: &'decoder mut dyn AudioDecoder,
    packet: &Packet,
) -> Result<Option<GenericAudioBufferRef<'decoder>>, BoxedError> {
    match decoder.decode(packet) {
        Ok(buffer) => Ok(Some(buffer)),
        Err(Error::DecodeError(_) | Error::IoError(_)) => Ok(None),
        Err(failure) => Err(failure.into()),
    }
}

fn send(produced: &mpsc::Sender<Vec<f32>>, frames: &[f32]) -> Result<(), BoxedError> {
    if frames.is_empty() {
        return Ok(());
    }
    produced.blocking_send(frames.to_vec())?;
    Ok(())
}

type Taps = Vec<(usize, f32)>;

struct Fold {
    channels: usize,
    left: Taps,
    right: Taps,
    frames: Vec<f32>,
}

impl Fold {
    fn create(channels: &Channels) -> Self {
        let count = channels.count();
        let (left, right) = match count {
            1 => (vec![(0, POWER_WEIGHT)], vec![(0, POWER_WEIGHT)]),
            2 => (vec![(0, 1.0)], vec![(1, 1.0)]),
            _ => surround(channels),
        };
        Self {
            channels: count,
            left,
            right,
            frames: Vec::new(),
        }
    }

    fn apply(&mut self, interleaved: &[f32]) -> &[f32] {
        self.frames.clear();
        for frame in interleaved.chunks_exact(self.channels) {
            self.frames.push(mix(frame, &self.left));
            self.frames.push(mix(frame, &self.right));
        }
        &self.frames
    }
}

fn surround(channels: &Channels) -> (Taps, Taps) {
    let mut left = Vec::new();
    let mut right = Vec::new();
    take(channels, Position::FRONT_LEFT, 1.0, &mut left);
    take(channels, Position::FRONT_RIGHT, 1.0, &mut right);
    take(channels, Position::FRONT_CENTER, POWER_WEIGHT, &mut left);
    take(channels, Position::FRONT_CENTER, POWER_WEIGHT, &mut right);
    for position in [Position::REAR_LEFT, Position::SIDE_LEFT] {
        take(channels, position, POWER_WEIGHT, &mut left);
    }
    for position in [Position::REAR_RIGHT, Position::SIDE_RIGHT] {
        take(channels, position, POWER_WEIGHT, &mut right);
    }
    if left.is_empty() || right.is_empty() {
        return (vec![(0, 1.0)], vec![(1, 1.0)]);
    }
    (left, right)
}

fn take(channels: &Channels, position: Position, weight: f32, taps: &mut Taps) {
    let Channels::Positioned(positions) = channels else {
        return;
    };
    if !positions.contains(position) {
        return;
    }
    if let Some(index) = channels.get_canonical_index_for_positioned_channel(position) {
        taps.push((index, weight));
    }
}

fn mix(frame: &[f32], taps: &Taps) -> f32 {
    taps.iter()
        .map(|(index, weight)| frame[*index] * weight)
        .sum()
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::SymphoniaPcm;
    use crate::{
        fixture::{Fixture, Signal, correlation, level, read_floats, worst_difference},
        pcm::{CHANNELS, PcmRequest, collect_interleaved_pcm},
        run::run,
    };

    const SOURCE_RATE: u32 = 48000;
    const SECONDS: f64 = 2.0;
    const TONE: &str = "0.6*sin(440*2*PI*t)|0.3*sin(523.25*2*PI*t+1)";
    const MONO_TONE: &str = "0.6*sin(440*2*PI*t)";
    const SURROUND_TONE: &str = "0.6*sin(440*2*PI*t)|0.3*sin(523.25*2*PI*t+1)|0.2*sin(659.25*2*PI*t)|0.1*sin(80*2*PI*t)|0.15*sin(880*2*PI*t)|0.12*sin(987.77*2*PI*t)";
    const TOLERANCE: f32 = 1e-6;
    const CORRELATION: f64 = 0.99;
    const LEVEL_TOLERANCE: f64 = 0.02;
    const AAC_PRIMING: usize = 1024;

    fn tone<'signal>(name: &'signal str, expression: &'signal str) -> Signal<'signal> {
        Signal {
            name,
            expression,
            seconds: SECONDS,
            sample_rate: SOURCE_RATE,
        }
    }

    async fn read_by_crate(from: &Path) -> Vec<f32> {
        let request = PcmRequest {
            from,
            sample_rate: SOURCE_RATE,
        };
        let bytes = collect_interleaved_pcm(&SymphoniaPcm, request)
            .await
            .expect("the decoder should read the file");
        read_floats(&bytes)
    }

    async fn read_by_ffmpeg(fixture: &Fixture, from: &Path) -> Vec<f32> {
        let arguments = vec![
            "-hide_banner".to_owned(),
            "-loglevel".to_owned(),
            "error".to_owned(),
            "-i".to_owned(),
            from.display().to_string(),
            "-map".to_owned(),
            "0:a:0".to_owned(),
            "-ac".to_owned(),
            "2".to_owned(),
            "-ar".to_owned(),
            SOURCE_RATE.to_string(),
            "-f".to_owned(),
            "f32le".to_owned(),
            "-".to_owned(),
        ];
        let bytes = run(&fixture.tools.ffmpeg, &arguments)
            .await
            .expect("ffmpeg should decode the file");
        read_floats(&bytes)
    }

    async fn compare(fixture: &Fixture, source: &Path, exact: bool) {
        let read = read_by_crate(source).await;
        let expected = read_by_ffmpeg(fixture, source).await;
        assert_eq!(read.len(), expected.len());
        if exact {
            let worst = worst_difference(&read, &expected);
            assert!(worst < TOLERANCE, "worst sample difference {worst}");
            return;
        }
        let matched = correlation(&read, &expected);
        assert!(matched > CORRELATION, "correlation {matched}");
        let gain = level(&read, &expected);
        assert!((gain - 1.0).abs() < LEVEL_TOLERANCE, "level {gain}");
    }

    async fn written(fixture: &Fixture, name: &str, format: &[&str]) -> std::path::PathBuf {
        fixture.write_as(&tone(name, TONE), format).await
    }

    #[tokio::test]
    async fn reads_a_wave_file_sample_for_sample() {
        let fixture = Fixture::create();
        let source = written(&fixture, "tone.wav", &["-c:a", "pcm_s24le"]).await;
        compare(&fixture, &source, true).await;
    }

    #[tokio::test]
    async fn reads_a_flac_file_sample_for_sample() {
        let fixture = Fixture::create();
        let source = written(&fixture, "tone.flac", &["-c:a", "flac"]).await;
        compare(&fixture, &source, true).await;
    }

    #[tokio::test]
    async fn reads_an_aiff_file_sample_for_sample() {
        let fixture = Fixture::create();
        let source = written(&fixture, "tone.aiff", &["-c:a", "pcm_s16be"]).await;
        compare(&fixture, &source, true).await;
    }

    #[tokio::test]
    async fn reads_an_apple_lossless_file_sample_for_sample() {
        let fixture = Fixture::create();
        let source = written(&fixture, "tone.m4a", &["-c:a", "alac"]).await;
        compare(&fixture, &source, true).await;
    }

    #[tokio::test]
    async fn reads_an_aac_file_after_its_encoder_priming() {
        let fixture = Fixture::create();
        let source = written(&fixture, "tone.m4a", &["-c:a", "aac", "-b:a", "192k"]).await;

        let read = read_by_crate(&source).await;
        let expected = read_by_ffmpeg(&fixture, &source).await;

        assert_eq!(read.len(), expected.len() + AAC_PRIMING * CHANNELS);
        let trimmed = &read[AAC_PRIMING * CHANNELS..];
        let matched = correlation(trimmed, &expected);
        assert!(matched > CORRELATION, "correlation {matched}");
        let gain = level(trimmed, &expected);
        assert!((gain - 1.0).abs() < LEVEL_TOLERANCE, "level {gain}");
    }

    #[tokio::test]
    async fn reads_a_vorbis_file_the_way_ffmpeg_reads_it() {
        let fixture = Fixture::create();
        let format = ["-c:a", "vorbis", "-strict", "-2", "-q:a", "6"];
        let source = written(&fixture, "tone.ogg", &format).await;
        compare(&fixture, &source, false).await;
    }

    #[tokio::test]
    async fn reads_an_mp3_file_the_way_ffmpeg_reads_it() {
        let fixture = Fixture::create();
        compare(&fixture, &Fixture::asset("tone.mp3"), false).await;
    }

    #[tokio::test]
    async fn spreads_a_mono_file_over_both_channels() {
        let fixture = Fixture::create();
        let source = fixture
            .write_as(&tone("mono.flac", MONO_TONE), &["-c:a", "flac"])
            .await;
        compare(&fixture, &source, true).await;
    }

    #[tokio::test]
    async fn folds_a_surround_file_the_way_ffmpeg_folds_it() {
        let fixture = Fixture::create();
        let source = fixture
            .write_as(&tone("surround.flac", SURROUND_TONE), &["-c:a", "flac"])
            .await;
        compare(&fixture, &source, true).await;
    }

    #[tokio::test]
    async fn refuses_a_stream_it_cannot_decode() {
        let fixture = Fixture::create();
        let source = written(&fixture, "tone.opus", &["-c:a", "opus", "-strict", "-2"]).await;
        let request = PcmRequest {
            from: &source,
            sample_rate: SOURCE_RATE,
        };
        let refused = collect_interleaved_pcm(&SymphoniaPcm, request).await;
        assert!(refused.is_err());
    }
}
