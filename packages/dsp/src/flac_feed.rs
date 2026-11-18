use std::io::Cursor;

use symphonia::{
    core::{
        codecs::audio::{AudioDecoder, AudioDecoderOptions},
        formats::{FormatOptions, FormatReader},
        io::{MediaSourceStream, MediaSourceStreamOptions},
    },
    default::formats::FlacReader,
};

use crate::{
    BoxedError,
    decode::{codecs, decode_packet, next_packet},
    flac::{FlacLayout, INFO_BYTE_LENGTH, read_layout},
    resample::{Conversion, SampleRates},
};

const NO_HEADER: &str = "The flac stream ended before its header";
const NO_PARAMETERS: &str = "The flac stream info declares no audio";

pub struct FlacFeed {
    sample_rate: Option<u32>,
    lead_in_frames: usize,
    received: Vec<u8>,
    received_from: u64,
    opened: Option<Opened>,
    ready: Vec<f32>,
}

impl FlacFeed {
    #[must_use]
    pub fn create(sample_rate: Option<u32>, lead_in_frames: usize) -> Self {
        Self {
            sample_rate,
            lead_in_frames,
            received: Vec::new(),
            received_from: 0,
            opened: None,
            ready: Vec::new(),
        }
    }

    #[must_use]
    pub fn channels(&self) -> Option<usize> {
        self.opened.as_ref().map(|opened| opened.channels)
    }

    #[must_use]
    pub fn frame_count(&self) -> Option<usize> {
        self.opened.as_ref().and_then(|opened| {
            opened
                .counted_frames
                .map(|counted| opened.conversion.output_frames(counted))
        })
    }

    pub fn push(&mut self, bytes: &[u8]) -> Result<&[f32], BoxedError> {
        self.ready.clear();
        self.received.extend_from_slice(bytes);
        if self.opened.is_none() {
            let Some(layout) = read_layout(&self.received)? else {
                return Ok(&self.ready);
            };
            self.received.drain(..usize::try_from(layout.frames_start)?);
            self.received_from = layout.frames_start;
            let mut opened = Opened::create(layout, self.sample_rate)?;
            opened.lead_in(self.lead_in_frames, &mut self.ready)?;
            self.opened = Some(opened);
        }
        let Some(opened) = self.opened.as_mut() else {
            return Ok(&self.ready);
        };
        let received_to = self.received_from + u64::try_from(self.received.len())?;
        while let Some(&end) = opened.span_ends.get(opened.next_span) {
            if end > received_to {
                break;
            }
            let length = usize::try_from(end - self.received_from)?;
            opened.decode(&self.received[..length], &mut self.ready)?;
            self.received.drain(..length);
            self.received_from = end;
            opened.next_span += 1;
        }
        Ok(&self.ready)
    }

    pub fn finish(&mut self) -> Result<&[f32], BoxedError> {
        self.ready.clear();
        let opened = self.opened.as_mut().ok_or(NO_HEADER)?;
        if !self.received.is_empty() {
            opened.decode(&self.received, &mut self.ready)?;
            self.received_from += u64::try_from(self.received.len())?;
            self.received.clear();
        }
        let flushed = opened.conversion.flush(opened.input_frames)?;
        self.ready.extend_from_slice(flushed);
        Ok(&self.ready)
    }
}

struct Opened {
    info_header: [u8; INFO_BYTE_LENGTH],
    span_ends: Vec<u64>,
    next_span: usize,
    channels: usize,
    counted_frames: Option<usize>,
    codec: Option<Box<dyn AudioDecoder>>,
    conversion: Conversion,
    interleaved: Vec<f32>,
    input_frames: usize,
}

impl Opened {
    fn create(layout: FlacLayout, sample_rate: Option<u32>) -> Result<Self, BoxedError> {
        let channels = usize::try_from(layout.info.channels)?;
        let rates = SampleRates {
            input: layout.info.sample_rate,
            output: sample_rate.unwrap_or(layout.info.sample_rate),
        };
        let conversion = Conversion::create(rates, channels)?;
        let counted = usize::try_from(layout.info.frame_count)?;
        let counted_frames = (counted > 0).then_some(counted);
        Ok(Self {
            info_header: layout.info_header,
            span_ends: layout.span_starts,
            next_span: 0,
            channels,
            counted_frames,
            codec: None,
            conversion,
            interleaved: Vec::new(),
            input_frames: 0,
        })
    }

    fn lead_in(&mut self, frames: usize, ready: &mut Vec<f32>) -> Result<(), BoxedError> {
        self.counted_frames = self.counted_frames.map(|counted| counted + frames);
        self.input_frames += frames;
        let silence = vec![0.0; frames * self.channels];
        ready.extend_from_slice(self.conversion.convert(&silence)?);
        Ok(())
    }

    fn decode(&mut self, span: &[u8], ready: &mut Vec<f32>) -> Result<(), BoxedError> {
        let mut reader = open_span(&self.info_header, span)?;
        let codec = match self.codec.as_mut() {
            Some(codec) => codec,
            None => self.codec.insert(make_codec(&reader)?),
        };
        while let Some(packet) = next_packet(&mut reader)? {
            let Some(buffer) = decode_packet(codec.as_mut(), &packet)? else {
                continue;
            };
            self.input_frames += buffer.frames();
            buffer.copy_to_vec_interleaved(&mut self.interleaved);
            ready.extend_from_slice(self.conversion.convert(&self.interleaved)?);
        }
        Ok(())
    }
}

fn make_codec(reader: &FlacReader<'_>) -> Result<Box<dyn AudioDecoder>, BoxedError> {
    let parameters = reader
        .tracks()
        .first()
        .and_then(|track| track.codec_params.as_ref())
        .and_then(|found| found.audio())
        .ok_or(NO_PARAMETERS)?;
    Ok(codecs().make_audio_decoder(parameters, &AudioDecoderOptions::default())?)
}

fn open_span(
    info_header: &[u8; INFO_BYTE_LENGTH],
    span: &[u8],
) -> Result<FlacReader<'static>, BoxedError> {
    let mut bytes = Vec::with_capacity(INFO_BYTE_LENGTH + span.len());
    bytes.extend_from_slice(info_header);
    bytes.extend_from_slice(span);
    let stream = MediaSourceStream::new(
        Box::new(Cursor::new(bytes)),
        MediaSourceStreamOptions::default(),
    );
    Ok(FlacReader::try_new(stream, FormatOptions::default())?)
}
