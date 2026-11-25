use std::ops::Range;

use super::{
    CHANNELS, Parts, Piece, Quantum, Renderer, STEM_COUNT, TakeTrack, Target,
    time_pitch::whole_to_i64,
};
use crate::{
    BoxedError,
    page_mix::{PageMixer, PageShape},
};

pub const QUANTUM: usize = 128;
const KEPT_SECONDS: i64 = 4;
const WRONG_PAGE: &str = "A page of a track holds another number of samples than its layout gives";

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

pub trait TrackPages {
    fn layout(&self, track: usize) -> StemLayout;
    fn read(&mut self, track: usize, index: usize) -> Result<Vec<f32>, BoxedError>;
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

struct Paged {
    track: usize,
    layout: StemLayout,
    song_start: f64,
    tempo: f64,
    resident: Range<usize>,
}

impl Paged {
    fn wanted(&self, frame: i64, kept: i64) -> Range<usize> {
        let into = |song_frame: i64| (frame_to_f64(song_frame) - self.song_start) / self.tempo;
        self.layout.pages_over(
            whole_to_i64(into(frame - kept).floor()),
            whole_to_i64(into(frame + kept).ceil()),
        )
    }
}

struct Pager {
    tracks: Vec<Paged>,
    kept: i64,
}

impl Pager {
    fn open(
        source: &dyn TrackPages,
        renderer: &mut Renderer,
        song: &Song,
        parts: Parts,
    ) -> Result<Self, BoxedError> {
        let mut tracks = Vec::with_capacity(STEM_COUNT + song.pieces.len());
        for stem in 0..STEM_COUNT {
            let layout = source.layout(stem);
            renderer
                .mixer()
                .set_track(stem, layout.frame_count, &layout.page_starts)?;
            tracks.push(Paged {
                track: stem,
                layout,
                song_start: 0.0,
                tempo: 1.0,
                resident: 0..0,
            });
        }
        if parts.takes {
            let mut takes = Vec::with_capacity(song.pieces.len());
            for piece in &song.pieces {
                let layout = source.layout(piece.track);
                takes.push(TakeTrack {
                    piece: *piece,
                    page_starts: layout.page_starts.clone(),
                    sounding: true,
                });
                tracks.push(Paged {
                    track: piece.track,
                    layout,
                    song_start: piece.song_start,
                    tempo: piece.tempo,
                    resident: 0..0,
                });
            }
            renderer.set_takes(&takes)?;
        }
        Ok(Self {
            tracks,
            kept: i64::from(song.sample_rate) * KEPT_SECONDS,
        })
    }

    fn feed(
        &mut self,
        source: &mut dyn TrackPages,
        mixer: &mut PageMixer,
        frame: i64,
    ) -> Result<(), BoxedError> {
        for paged in &mut self.tracks {
            let wanted = paged.wanted(frame, self.kept);
            let held = paged.resident.clone();
            for index in held.start..wanted.start.min(held.end) {
                mixer.drop_page(paged.track, index)?;
            }
            for index in wanted.clone().filter(|index| !held.contains(index)) {
                load_page(source, mixer, &paged.layout, (paged.track, index))?;
            }
            paged.resident = wanted;
        }
        Ok(())
    }
}

fn load_page(
    source: &mut dyn TrackPages,
    mixer: &mut PageMixer,
    layout: &StemLayout,
    (track, index): (usize, usize),
) -> Result<(), BoxedError> {
    let samples = source.read(track, index)?;
    let frames = usize::try_from(layout.page_end(index) - layout.page_starts[index])?;
    if frames == 0 || !samples.len().is_multiple_of(frames) {
        return Err(WRONG_PAGE.into());
    }
    let shape = PageShape {
        track,
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
    renderer
}

pub fn render_song(
    source: &mut dyn TrackPages,
    song: &Song,
    parts: Parts,
    go_on: &mut dyn FnMut(usize) -> bool,
) -> Result<Option<Vec<f32>>, BoxedError> {
    let mut renderer = prepare(song);
    let mut pager = Pager::open(source, &mut renderer, song, parts)?;
    let frames = song.frame_count;
    let channels = parts.channels();
    let mut output = vec![0.0; channels * frames];
    let mut block = vec![0.0; CHANNELS * QUANTUM];
    let mut frame = 0_i64;
    let mut written = 0;
    while written < frames {
        if !go_on(written) {
            return Ok(None);
        }
        pager.feed(source, renderer.mixer(), frame)?;
        let quantum = Quantum {
            frame,
            take_frame: Some(frame_to_f64(frame)),
        };
        let processed = renderer.render_parts(parts, quantum, &mut block);
        let count = QUANTUM.min(frames - written);
        for (offset, frame_out) in output[written * channels..(written + count) * channels]
            .chunks_exact_mut(channels)
            .enumerate()
        {
            for (channel, sample) in frame_out.iter_mut().enumerate() {
                *sample = block[channel * QUANTUM + offset];
            }
        }
        written += count;
        frame += i64::try_from(processed)?;
    }
    Ok(Some(output))
}
