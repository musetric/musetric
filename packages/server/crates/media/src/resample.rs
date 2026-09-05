use rubato::{Fft, FixedSync, Indexing, Resampler, audioadapter_buffers::direct::InterleavedSlice};

use crate::{BoxedError, pcm::CHANNELS};

const CHUNK_FRAMES: usize = 1024;
const STALLED: &str = "The resampler stopped producing frames before the stream ended";

#[derive(Clone, Copy)]
pub struct SampleRates {
    pub input: u32,
    pub output: u32,
}

pub(crate) struct Conversion {
    resampler: Option<Fft<f32>>,
    input: Vec<f32>,
    produced: Vec<f32>,
    ready: Vec<f32>,
    ratio: f64,
    delay_frames: usize,
    dropped_frames: usize,
    written_frames: usize,
    expected_frames: Option<usize>,
}

impl Conversion {
    pub(crate) fn create(rates: SampleRates) -> Result<Self, BoxedError> {
        let ratio = f64::from(rates.output) / f64::from(rates.input);
        let resampler = create_resampler(rates)?;
        let delay_frames = resampler.as_ref().map_or(0, Resampler::output_delay);
        Ok(Self {
            resampler,
            input: Vec::new(),
            produced: Vec::new(),
            ready: Vec::new(),
            ratio,
            delay_frames,
            dropped_frames: 0,
            written_frames: 0,
            expected_frames: None,
        })
    }

    pub(crate) fn convert(&mut self, frames: &[f32]) -> Result<&[f32], BoxedError> {
        self.ready.clear();
        if self.resampler.is_none() {
            self.ready.extend_from_slice(frames);
            return Ok(&self.ready);
        }
        self.input.extend_from_slice(frames);
        while self.filled() {
            self.step()?;
            self.keep();
        }
        Ok(&self.ready)
    }

    pub(crate) fn flush(&mut self, input_frames: usize) -> Result<&[f32], BoxedError> {
        self.ready.clear();
        if self.resampler.is_none() {
            return Ok(&self.ready);
        }
        let expected = expected_frames(input_frames, self.ratio);
        self.expected_frames = Some(expected);
        while self.written_frames < expected {
            self.step()?;
            if self.produced.is_empty() {
                return Err(STALLED.into());
            }
            self.keep();
        }
        Ok(&self.ready)
    }

    fn filled(&self) -> bool {
        self.resampler
            .as_ref()
            .is_some_and(|resampler| self.input.len() >= resampler.input_frames_next() * CHANNELS)
    }

    fn step(&mut self) -> Result<(), BoxedError> {
        self.produced.clear();
        let Some(resampler) = self.resampler.as_mut() else {
            return Ok(());
        };
        let needed = resampler.input_frames_next();
        let taken = (self.input.len() / CHANNELS).min(needed);
        let mut chunk = vec![0.0_f32; needed * CHANNELS];
        chunk[..taken * CHANNELS].copy_from_slice(&self.input[..taken * CHANNELS]);
        let source = InterleavedSlice::new(&chunk, CHANNELS, needed)?;
        let capacity = resampler.output_frames_next();
        self.produced.resize(capacity * CHANNELS, 0.0);
        let mut target = InterleavedSlice::new_mut(&mut self.produced, CHANNELS, capacity)?;
        let indexing = Indexing {
            input_offset: 0,
            output_offset: 0,
            partial_len: (taken < needed).then_some(taken),
            active_channels_mask: None,
        };
        let (_, written) = resampler.process_into_buffer(&source, &mut target, Some(&indexing))?;
        self.produced.truncate(written * CHANNELS);
        self.input.drain(..taken * CHANNELS);
        Ok(())
    }

    fn keep(&mut self) {
        for frame in self.produced.chunks_exact(CHANNELS) {
            if self.dropped_frames < self.delay_frames {
                self.dropped_frames += 1;
            } else if self
                .expected_frames
                .is_none_or(|expected| self.written_frames < expected)
            {
                self.ready.extend_from_slice(frame);
                self.written_frames += 1;
            }
        }
    }
}

fn create_resampler(rates: SampleRates) -> Result<Option<Fft<f32>>, BoxedError> {
    if rates.input == rates.output {
        return Ok(None);
    }
    let resampler = Fft::<f32>::new(
        usize::try_from(rates.input)?,
        usize::try_from(rates.output)?,
        CHUNK_FRAMES,
        CHANNELS,
        FixedSync::Input,
    )?;
    Ok(Some(resampler))
}

#[expect(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "the frame count of a recording stays far below the exact range of f64"
)]
fn expected_frames(input_frames: usize, ratio: f64) -> usize {
    (input_frames as f64 * ratio).round() as usize
}
