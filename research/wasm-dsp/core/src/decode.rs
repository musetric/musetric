use std::{f32::consts::FRAC_1_SQRT_2, io::Cursor, ops::Range};

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
    io::{MediaSourceStream, MediaSourceStreamOptions},
    meta::MetadataOptions,
    packet::Packet,
};

use crate::{
    BoxedError,
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

pub fn decode(
    bytes: Vec<u8>,
    extension: &str,
    sample_rate: u32,
) -> Result<(Vec<f32>, u32), BoxedError> {
    let mut track = open(bytes, extension)?;
    let source_rate = track.sample_rate;
    let target = if sample_rate == 0 {
        source_rate
    } else {
        sample_rate
    };
    let rates = SampleRates {
        input: source_rate,
        output: target,
    };
    let mut conversion = Conversion::create(rates)?;
    let mut interleaved = Vec::new();
    let mut out = Vec::new();
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
        out.extend_from_slice(conversion.convert(frames)?);
    }
    out.extend_from_slice(conversion.flush(read_frames)?);
    Ok((out, source_rate))
}

pub fn decode_window(
    bytes: &'static [u8],
    extension: &str,
    start_ms: i64,
    length_ms: i64,
) -> Result<Vec<f32>, BoxedError> {
    use symphonia::core::{
        formats::{SeekMode, SeekTo},
        units::Time,
    };
    let stream = MediaSourceStream::new(
        Box::new(Cursor::new(bytes)),
        MediaSourceStreamOptions::default(),
    );
    let mut hint = Hint::new();
    hint.with_extension(extension);
    let mut reader = symphonia::default::get_probe().probe(
        &hint,
        stream,
        FormatOptions::default(),
        MetadataOptions::default(),
    )?;
    let track = reader
        .default_track(TrackType::Audio)
        .ok_or(BoxedError::from(NO_TRACK))?;
    let id = track.id;
    let parameters = track
        .codec_params
        .as_ref()
        .and_then(|found| found.audio())
        .ok_or(BoxedError::from(NO_PARAMETERS))?
        .clone();
    let rate = parameters
        .sample_rate
        .ok_or(BoxedError::from(NO_SAMPLE_RATE))?;
    let channels = parameters
        .channels
        .clone()
        .ok_or(BoxedError::from(NO_CHANNELS))?;
    let mut decoder = codecs().make_audio_decoder(&parameters, &AudioDecoderOptions::default())?;
    let seeked = reader.seek(
        SeekMode::Accurate,
        SeekTo::Time {
            time: Time::from_millis(start_ms),
            track_id: Some(id),
        },
    )?;
    decoder.reset();
    let mut skip = usize::try_from((seeked.required_ts.get() - seeked.actual_ts.get()).max(0))?;
    let wanted = usize::try_from(length_ms)? * rate as usize / 1000;
    let mut fold = Fold::create(&channels);
    let mut interleaved = Vec::new();
    let mut out = Vec::with_capacity(wanted * 2);
    while out.len() < wanted * 2 {
        let Some(packet) = next_packet(reader.as_mut())? else {
            break;
        };
        if packet.track_id != id {
            continue;
        }
        let Some(buffer) = decode_packet(decoder.as_mut(), &packet)? else {
            continue;
        };
        buffer.copy_to_vec_interleaved(&mut interleaved);
        let frames = fold.apply(&interleaved);
        let dropped = skip.min(frames.len() / 2);
        skip -= dropped;
        out.extend_from_slice(&frames[dropped * 2..]);
    }
    out.truncate(wanted * 2);
    Ok(out)
}

struct Track {
    reader: Box<dyn FormatReader>,
    decoder: Box<dyn AudioDecoder>,
    id: u32,
    fold: Fold,
    sample_rate: u32,
}

fn open(bytes: Vec<u8>, extension: &str) -> Result<Track, BoxedError> {
    let reader = probe(bytes, extension)?;
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
        fold: Fold::create(&channels),
        sample_rate,
    })
}

fn codecs() -> CodecRegistry {
    let mut codecs = CodecRegistry::new();
    symphonia::default::register_enabled_codecs(&mut codecs);
    #[cfg(not(target_arch = "wasm32"))]
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

fn probe(bytes: Vec<u8>, extension: &str) -> Result<Box<dyn FormatReader>, BoxedError> {
    let stream = MediaSourceStream::new(
        Box::new(Cursor::new(bytes)),
        MediaSourceStreamOptions::default(),
    );
    let mut hint = Hint::new();
    hint.with_extension(extension);
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
