use std::ops::Range;

use super::{CHANNELS, Parts, Piece, Quantum, Renderer, STEM_COUNT, Target};
use crate::{
    BoxedError,
    page_mix::{PageMixer, PageShape},
};

pub const QUANTUM: usize = 128;
const KEPT_SECONDS: i64 = 4;
const WRONG_PAGE: &str = "A page of a stem holds another number of samples than its layout gives";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StemLayout {
    pub frame_count: i64,
    pub page_starts: Vec<i64>,
}

impl StemLayout {
    fn page_end(&self, index: usize) -> i64 {
        self.page_starts
            .get(index + 1)
            .copied()
            .unwrap_or(self.frame_count)
    }

    fn pages_over(&self, from: i64, to: i64) -> Range<usize> {
        let first = self
            .page_starts
            .partition_point(|start| *start <= from)
            .saturating_sub(1);
        let last = self.page_starts.partition_point(|start| *start < to);
        first..last.max(first)
    }
}

pub trait StemPages {
    fn layout(&self, stem: usize) -> StemLayout;
    fn read(&mut self, stem: usize, index: usize) -> Result<Vec<f32>, BoxedError>;
}

#[derive(Clone, Debug, PartialEq)]
pub struct Song {
    pub sample_rate: u32,
    pub frame_count: usize,
    pub volumes: [f32; STEM_COUNT],
    pub target: Target,
    pub recording_volume: f32,
    pub pieces: Vec<Piece>,
}

struct Pager {
    layouts: Vec<StemLayout>,
    resident: Vec<Range<usize>>,
    kept: i64,
}

impl Pager {
    fn open(
        stems: &dyn StemPages,
        mixer: &mut PageMixer,
        sample_rate: u32,
    ) -> Result<Self, BoxedError> {
        let layouts: Vec<StemLayout> = (0..STEM_COUNT).map(|stem| stems.layout(stem)).collect();
        for (stem, layout) in layouts.iter().enumerate() {
            mixer.set_stem(stem, layout.frame_count, &layout.page_starts)?;
        }
        Ok(Self {
            resident: vec![0..0; layouts.len()],
            layouts,
            kept: i64::from(sample_rate) * KEPT_SECONDS,
        })
    }

    fn feed(
        &mut self,
        stems: &mut dyn StemPages,
        mixer: &mut PageMixer,
        frame: i64,
    ) -> Result<(), BoxedError> {
        for (stem, layout) in self.layouts.iter().enumerate() {
            let wanted = layout.pages_over(frame - self.kept, frame + self.kept);
            let held = self.resident[stem].clone();
            for index in held.start..wanted.start.min(held.end) {
                mixer.drop_page(stem, index)?;
            }
            for index in wanted.clone().filter(|index| !held.contains(index)) {
                load_page(stems, mixer, layout, (stem, index))?;
            }
            self.resident[stem] = wanted;
        }
        Ok(())
    }
}

fn load_page(
    stems: &mut dyn StemPages,
    mixer: &mut PageMixer,
    layout: &StemLayout,
    (stem, index): (usize, usize),
) -> Result<(), BoxedError> {
    let samples = stems.read(stem, index)?;
    let frames = usize::try_from(layout.page_end(index) - layout.page_starts[index])?;
    if frames == 0 || !samples.len().is_multiple_of(frames) {
        return Err(WRONG_PAGE.into());
    }
    let shape = PageShape {
        stem,
        index,
        frames,
        channels: samples.len() / frames,
    };
    mixer.page_input(shape)?.copy_from_slice(&samples);
    Ok(())
}

#[expect(
    clippy::cast_precision_loss,
    reason = "a frame of a song is far below the f64 mantissa"
)]
const fn frame_to_f64(frame: i64) -> f64 {
    frame as f64
}

fn prepare(song: &Song) -> Renderer {
    let mut renderer = Renderer::new(song.sample_rate);
    renderer.set_volumes(&song.volumes);
    renderer.set_tempo(song.target.tempo);
    renderer.set_voice(song.target.voice_octave, song.target.voice_shifted);
    renderer.set_transpose(song.target.transpose);
    renderer.set_recording_volume(song.recording_volume);
    renderer.takes().set_pieces(song.pieces.clone(), None, true);
    renderer
}

pub fn render_song(
    stems: &mut dyn StemPages,
    song: &Song,
    parts: Parts,
    go_on: &mut dyn FnMut(usize) -> bool,
) -> Result<Option<Vec<f32>>, BoxedError> {
    let mut renderer = prepare(song);
    let mut pager = Pager::open(stems, renderer.mixer(), song.sample_rate)?;
    let frames = song.frame_count;
    let mut output = vec![0.0; CHANNELS * frames];
    let mut block = vec![0.0; CHANNELS * QUANTUM];
    let mut frame = 0_i64;
    let mut written = 0;
    while written < frames {
        if !go_on(written) {
            return Ok(None);
        }
        pager.feed(stems, renderer.mixer(), frame)?;
        let quantum = Quantum {
            frame,
            take_frame: Some(frame_to_f64(frame)),
        };
        let processed = renderer.render_parts(parts, quantum, &mut block);
        let count = QUANTUM.min(frames - written);
        for channel in 0..CHANNELS {
            let at = channel * frames + written;
            output[at..at + count]
                .copy_from_slice(&block[channel * QUANTUM..channel * QUANTUM + count]);
        }
        written += count;
        frame += i64::try_from(processed)?;
    }
    Ok(Some(output))
}
