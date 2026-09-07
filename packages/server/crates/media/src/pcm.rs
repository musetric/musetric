use std::{future::Future, path::Path, pin::Pin};

use crate::BoxedError;

pub(crate) const CHANNELS: usize = 2;
pub(crate) const BYTES_PER_FRAME: usize = CHANNELS * size_of::<f32>();
pub(crate) const READ_BUFFER_BYTE_LENGTH: usize = 64 * 1024;
const NO_AUDIO: &str = "The decoder produced no audio data";

#[derive(Clone, Copy)]
pub struct PcmRequest<'request> {
    pub from: &'request Path,
    pub sample_rate: u32,
}

pub type ReadingPcm<'reading> =
    Pin<Box<dyn Future<Output = Result<(), BoxedError>> + Send + 'reading>>;

pub type PcmSink<'sink> = &'sink mut (dyn FnMut(&[f32]) + Send);

pub type DecodedFrames<'decoded> = &'decoded mut (dyn FnMut(u64) + Send);

pub trait PcmSource: Send + Sync {
    fn read_pcm<'source>(
        &'source self,
        request: PcmRequest<'source>,
        sink: PcmSink<'source>,
    ) -> ReadingPcm<'source>;
}

#[derive(Default)]
pub(crate) struct Frames {
    carry: Vec<u8>,
    samples: Vec<f32>,
}

impl Frames {
    pub(crate) fn push(&mut self, bytes: &[u8]) -> &[f32] {
        self.samples.clear();
        self.carry.extend_from_slice(bytes);
        let aligned = self.carry.len() - self.carry.len() % BYTES_PER_FRAME;
        for value in self.carry[..aligned].chunks_exact(size_of::<f32>()) {
            self.samples.push(read_float(value));
        }
        self.carry.drain(..aligned);
        &self.samples
    }
}

fn read_float(bytes: &[u8]) -> f32 {
    <[u8; 4]>::try_from(bytes).map_or(0.0, f32::from_le_bytes)
}

pub async fn collect_interleaved_pcm(
    source: &dyn PcmSource,
    request: PcmRequest<'_>,
    decoded: DecodedFrames<'_>,
) -> Result<Vec<u8>, BoxedError> {
    let mut collected = Vec::new();
    read_into(source, request, &mut collected, decoded).await?;
    if collected.is_empty() {
        return Err(NO_AUDIO.into());
    }
    Ok(collected)
}

async fn read_into(
    source: &dyn PcmSource,
    request: PcmRequest<'_>,
    collected: &mut Vec<u8>,
    decoded: DecodedFrames<'_>,
) -> Result<(), BoxedError> {
    let mut frames = 0_u64;
    let mut sink = |chunk: &[f32]| {
        for frame in chunk.chunks_exact(CHANNELS) {
            for sample in frame {
                collected.extend_from_slice(&sample.to_le_bytes());
            }
            frames += 1;
        }
        decoded(frames);
    };
    source.read_pcm(request, &mut sink).await
}
