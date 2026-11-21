use symphonia::core::codecs::audio::AudioDecoder;

use crate::{
    BoxedError,
    decode::{decode_packet, next_packet},
    flac::{INFO_BYTE_LENGTH, read_layout},
    flac_feed::{make_codec, open_span},
    mono::Downmix,
};

const NO_COUNT: &str = "The flac master does not count its frames";
const NO_PAGE: &str = "The flac master has no such page";
const WRONG_LENGTH: &str = "The flac page decoded to another length than its seek table gives";
const NOT_STEREO: &str = "Only a stereo page folds to the mean of its channels";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FlacPage {
    pub first_frame: u64,
    pub frames: u64,
    pub byte_start: u64,
    pub byte_end: Option<u64>,
}

pub struct FlacPages {
    info_header: [u8; INFO_BYTE_LENGTH],
    channels: usize,
    sample_rate: u32,
    frame_count: u64,
    pages: Vec<FlacPage>,
    codec: Option<Box<dyn AudioDecoder>>,
    interleaved: Vec<f32>,
    decoded: Vec<f32>,
    planar: Vec<f32>,
}

impl FlacPages {
    pub fn read(prefix: &[u8]) -> Result<Option<Self>, BoxedError> {
        let Some(layout) = read_layout(prefix)? else {
            return Ok(None);
        };
        let frame_count = layout.info.frame_count;
        if frame_count == 0 {
            return Err(NO_COUNT.into());
        }
        let points = &layout.seek_points;
        let pages = points
            .iter()
            .enumerate()
            .map(|(index, point)| {
                let next = points.get(index + 1);
                FlacPage {
                    first_frame: point.frame,
                    frames: next.map_or(frame_count, |found| found.frame) - point.frame,
                    byte_start: point.byte,
                    byte_end: next.map(|found| found.byte),
                }
            })
            .collect();
        Ok(Some(Self {
            info_header: layout.info_header,
            channels: usize::try_from(layout.info.channels)?,
            sample_rate: layout.info.sample_rate,
            frame_count,
            pages,
            codec: None,
            interleaved: Vec::new(),
            decoded: Vec::new(),
            planar: Vec::new(),
        }))
    }

    #[must_use]
    pub fn channels(&self) -> usize {
        self.channels
    }

    #[must_use]
    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    #[must_use]
    pub fn frame_count(&self) -> u64 {
        self.frame_count
    }

    #[must_use]
    pub fn pages(&self) -> &[FlacPage] {
        &self.pages
    }

    pub fn decode_mean(&mut self, index: usize, bytes: &[u8]) -> Result<&[f32], BoxedError> {
        if self.channels != 2 {
            return Err(NOT_STEREO.into());
        }
        self.decode_interleaved(index, bytes)?;
        self.planar.clear();
        self.planar.extend(
            self.decoded
                .as_chunks::<2>()
                .0
                .iter()
                .map(|[left, right]| Downmix::Mean.apply(*left, *right)),
        );
        Ok(&self.planar)
    }

    pub fn decode(&mut self, index: usize, bytes: &[u8]) -> Result<&[f32], BoxedError> {
        self.decode_interleaved(index, bytes)?;
        self.planar.clear();
        for channel in 0..self.channels {
            self.planar.extend(
                self.decoded
                    .iter()
                    .skip(channel)
                    .step_by(self.channels)
                    .copied(),
            );
        }
        Ok(&self.planar)
    }

    fn decode_interleaved(&mut self, index: usize, bytes: &[u8]) -> Result<(), BoxedError> {
        let page = *self.pages.get(index).ok_or(NO_PAGE)?;
        let mut reader = open_span(&self.info_header, bytes)?;
        let codec = match self.codec.as_mut() {
            Some(codec) => {
                codec.reset();
                codec
            }
            None => self.codec.insert(make_codec(&reader)?),
        };
        self.decoded.clear();
        while let Some(packet) = next_packet(&mut reader)? {
            let Some(buffer) = decode_packet(codec.as_mut(), &packet)? else {
                continue;
            };
            buffer.copy_to_vec_interleaved(&mut self.interleaved);
            self.decoded.extend_from_slice(&self.interleaved);
        }
        let frames = self.decoded.len() / self.channels;
        if u64::try_from(frames)? != page.frames {
            return Err(WRONG_LENGTH.into());
        }
        Ok(())
    }
}
