use std::{f32::consts::FRAC_1_SQRT_2, ops::Range};

use symphonia::core::{
    audio::{Channels, GenericAudioBufferRef, Position},
    codecs::{
        audio::{
            AudioCodecParameters, AudioDecoder, AudioDecoderOptions, well_known::CODEC_ID_OPUS,
        },
        registry::CodecRegistry,
    },
    errors::Error,
    formats::{FormatOptions, FormatReader, TrackType, probe::Hint},
    io::{MediaSource, MediaSourceStream, MediaSourceStreamOptions},
    meta::MetadataOptions,
    packet::Packet,
};

use crate::{
    BoxedError, CHANNELS,
    resample::{Conversion, SampleRates},
};

const POWER_WEIGHT: f32 = FRAC_1_SQRT_2;
const NO_TRACK: &str = "The file carries no audio track";
const NO_PARAMETERS: &str = "The audio track declares no codec parameters";
const NO_SAMPLE_RATE: &str = "The audio track declares no sample rate";
const NO_CHANNELS: &str = "The audio track declares no channels";
const OPUS_HEAD_LENGTH: usize = 19;
const OPUS_HEAD_VERSION_OFFSET: usize = 8;
const MP4_OPUS_HEAD_VERSION: u8 = 0;
const OGG_OPUS_HEAD_VERSION: u8 = 1;
const MP4_BIG_ENDIAN_OPUS_HEAD_FIELDS: [Range<usize>; 3] = [10..12, 12..16, 16..18];

pub type DecodedSink<'sink> = &'sink mut dyn FnMut(&[f32]) -> Result<(), BoxedError>;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Layout {
    Stereo,
    Source,
}

pub struct DecodeRequest<'request> {
    pub source: Box<dyn MediaSource>,
    pub extension: Option<&'request str>,
    pub sample_rate: Option<u32>,
    pub layout: Layout,
}

pub fn decode(request: DecodeRequest<'_>, sink: DecodedSink<'_>) -> Result<u32, BoxedError> {
    let mut decoder = Decoder::open(request)?;
    while let Some(frames) = decoder.read()? {
        sink(frames)?;
    }
    Ok(decoder.sample_rate())
}

pub struct Decoder {
    reader: Box<dyn FormatReader>,
    codec: Box<dyn AudioDecoder>,
    id: u32,
    fold: Option<Fold>,
    channels: usize,
    conversion: Conversion,
    sample_rate: u32,
    interleaved: Vec<f32>,
    read_frames: usize,
    finished: bool,
}

impl Decoder {
    pub fn open(request: DecodeRequest<'_>) -> Result<Self, BoxedError> {
        let track = open(request.source, request.extension)?;
        let fold = match request.layout {
            Layout::Stereo => Some(Fold::create(&track.channels)),
            Layout::Source => None,
        };
        let channels = fold.as_ref().map_or(track.channels.count(), |_| CHANNELS);
        let rates = SampleRates {
            input: track.sample_rate,
            output: request.sample_rate.unwrap_or(track.sample_rate),
        };
        Ok(Self {
            reader: track.reader,
            codec: track.decoder,
            id: track.id,
            fold,
            channels,
            conversion: Conversion::create(rates, channels)?,
            sample_rate: rates.output,
            interleaved: Vec::new(),
            read_frames: 0,
            finished: false,
        })
    }

    #[must_use]
    pub fn channels(&self) -> usize {
        self.channels
    }

    #[must_use]
    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn read(&mut self) -> Result<Option<&[f32]>, BoxedError> {
        if self.finished {
            return Ok(None);
        }
        while let Some(packet) = next_packet(self.reader.as_mut())? {
            if packet.track_id != self.id {
                continue;
            }
            let Some(buffer) = decode_packet(self.codec.as_mut(), &packet)? else {
                continue;
            };
            self.read_frames += buffer.frames();
            buffer.copy_to_vec_interleaved(&mut self.interleaved);
            let frames = match self.fold.as_mut() {
                Some(fold) => fold.apply(&self.interleaved),
                None => &self.interleaved,
            };
            return Ok(Some(self.conversion.convert(frames)?));
        }
        self.finished = true;
        Ok(Some(self.conversion.flush(self.read_frames)?))
    }
}

struct Track {
    reader: Box<dyn FormatReader>,
    decoder: Box<dyn AudioDecoder>,
    id: u32,
    channels: Channels,
    sample_rate: u32,
}

fn open(source: Box<dyn MediaSource>, extension: Option<&str>) -> Result<Track, BoxedError> {
    let reader = probe(source, extension)?;
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
    let decoder = codecs().make_audio_decoder(
        &ogg_opus_head_from_mp4(parameters.clone()),
        &AudioDecoderOptions::default(),
    )?;
    Ok(Track {
        reader,
        decoder,
        id,
        channels,
        sample_rate,
    })
}

pub(crate) fn codecs() -> CodecRegistry {
    let mut codecs = CodecRegistry::new();
    symphonia::default::register_enabled_codecs(&mut codecs);
    #[cfg(feature = "opus")]
    codecs.register_audio_decoder::<symphonia_adapter_libopus::OpusDecoder>();
    codecs
}

fn ogg_opus_head_from_mp4(mut parameters: AudioCodecParameters) -> AudioCodecParameters {
    if parameters.codec != CODEC_ID_OPUS {
        return parameters;
    }
    let Some(head) = parameters.extra_data.as_mut() else {
        return parameters;
    };
    if head.len() < OPUS_HEAD_LENGTH || head[OPUS_HEAD_VERSION_OFFSET] != MP4_OPUS_HEAD_VERSION {
        return parameters;
    }
    head[OPUS_HEAD_VERSION_OFFSET] = OGG_OPUS_HEAD_VERSION;
    for field in MP4_BIG_ENDIAN_OPUS_HEAD_FIELDS {
        head[field].reverse();
    }
    parameters
}

fn probe(
    source: Box<dyn MediaSource>,
    extension: Option<&str>,
) -> Result<Box<dyn FormatReader>, BoxedError> {
    let stream = MediaSourceStream::new(source, MediaSourceStreamOptions::default());
    let mut hint = Hint::new();
    if let Some(found) = extension {
        hint.with_extension(found);
    }
    let reader = symphonia::default::get_probe().probe(
        &hint,
        stream,
        FormatOptions::default(),
        MetadataOptions::default(),
    )?;
    Ok(reader)
}

pub(crate) fn next_packet(reader: &mut dyn FormatReader) -> Result<Option<Packet>, BoxedError> {
    match reader.next_packet() {
        Ok(packet) => Ok(packet),
        Err(Error::ResetRequired) => Ok(None),
        Err(failure) => Err(failure.into()),
    }
}

pub(crate) fn decode_packet<'decoder>(
    decoder: &'decoder mut dyn AudioDecoder,
    packet: &Packet,
) -> Result<Option<GenericAudioBufferRef<'decoder>>, BoxedError> {
    match decoder.decode(packet) {
        Ok(buffer) => Ok(Some(buffer)),
        Err(Error::DecodeError(_) | Error::IoError(_)) => Ok(None),
        Err(failure) => Err(failure.into()),
    }
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
