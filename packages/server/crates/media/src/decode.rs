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
    BoxedError,
    pcm::{PcmRequest, PcmSink, PcmSource, ReadingPcm},
    resample::{Conversion, SampleRates},
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
