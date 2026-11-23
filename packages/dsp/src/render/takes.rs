use super::time_pitch::{Block, TimePitch, frames_to_f64, js_round, whole_to_i64};

const UNIT_RATIO_TOLERANCE: f64 = 1e-6;
const CONTINUITY_FRAMES: f64 = 4.0;
const SEMITONES_PER_OCTAVE: i32 = 12;

#[derive(Clone, Debug, PartialEq)]
pub struct Piece {
    pub song_start: f64,
    pub tempo: f64,
    pub transpose: i32,
    pub octave: i32,
    pub samples: Vec<f32>,
}

impl Piece {
    fn song_end(&self) -> f64 {
        self.song_start + frames_to_f64(self.samples.len()) * self.tempo
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TakeKey {
    pub tempo: f64,
    pub transpose: i32,
    pub octave: i32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TakeMix {
    pub song_frame: f64,
    pub target: Target,
    pub volume: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Target {
    pub tempo: f64,
    pub transpose: i32,
    pub voice_octave: i32,
    pub voice_shifted: bool,
}

impl Target {
    pub const ORIGINAL: Self = Self {
        tempo: 1.0,
        transpose: 0,
        voice_octave: 0,
        voice_shifted: false,
    };

    #[must_use]
    pub fn shift(self, piece: &Piece) -> (f64, i32) {
        let octaves = if self.voice_shifted {
            self.voice_octave - piece.octave
        } else {
            0
        };
        (
            self.tempo / piece.tempo,
            self.transpose - piece.transpose + SEMITONES_PER_OCTAVE * octaves,
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Segment {
    pub start: f64,
    pub end: f64,
    pub piece: usize,
}

#[must_use]
pub fn lay_out(pieces: &[&Piece]) -> Vec<Segment> {
    let mut segments: Vec<Segment> = Vec::new();
    for (index, piece) in pieces.iter().enumerate() {
        let start = piece.song_start;
        let end = piece.song_end();
        if end <= start {
            continue;
        }
        let mut kept = Vec::with_capacity(segments.len() + 2);
        for segment in &segments {
            if segment.end <= start || segment.start >= end {
                kept.push(*segment);
                continue;
            }
            if segment.start < start {
                kept.push(Segment {
                    end: start,
                    ..*segment
                });
            }
            if segment.end > end {
                kept.push(Segment {
                    start: end,
                    ..*segment
                });
            }
        }
        kept.push(Segment {
            start,
            end,
            piece: index,
        });
        kept.sort_by(|left, right| left.start.total_cmp(&right.start));
        segments = kept;
    }
    segments
}

fn first_ending_after(segments: &[Segment], song_frame: f64) -> usize {
    segments.partition_point(|segment| segment.end <= song_frame)
}

struct LiveRun {
    start_frame: f64,
    first_offset: f64,
    piece: Piece,
}

struct Live {
    take: String,
    key: TakeKey,
    runs: Vec<LiveRun>,
}

#[derive(Clone, Copy, PartialEq)]
struct Played {
    piece: usize,
    stretched: bool,
    song_end: f64,
    raw_end: i64,
}

#[derive(Clone, Copy)]
struct Part {
    from: usize,
    to: usize,
    segment: Segment,
    song_frame: f64,
}

pub struct Takes {
    pieces: Vec<Piece>,
    live: Option<Live>,
    segments: Vec<Segment>,
    stretcher: TimePitch,
    previous: Option<Played>,
    current: Option<Played>,
    scratch: Vec<f32>,
}

fn piece_at<'pieces>(
    pieces: &'pieces [Piece],
    live: Option<&'pieces Live>,
    index: usize,
) -> Option<&'pieces Piece> {
    if index < pieces.len() {
        return pieces.get(index);
    }
    live?.runs.get(index - pieces.len()).map(|run| &run.piece)
}

#[must_use]
#[expect(
    clippy::float_cmp,
    reason = "the song is stretched unless its tempo is exactly the original one, as the player bypasses it"
)]
pub fn stretches(target: Target, pieces: &[Piece]) -> bool {
    let shift = if target.voice_shifted {
        target.voice_octave
    } else {
        0
    };
    target.tempo != 1.0
        || target.transpose != 0
        || shift != 0
        || pieces.iter().any(|piece| {
            let (ratio, semitones) = target.shift(piece);
            (ratio - 1.0).abs() >= UNIT_RATIO_TOLERANCE || semitones != 0
        })
}

fn add_gained_into(channel: &mut [f32], take: &[f32], volume: f32) {
    for (sample, value) in channel.iter_mut().zip(take) {
        *sample += value * volume;
    }
}

fn raw_sample(samples: &[f32], frame: i64) -> f32 {
    usize::try_from(frame)
        .ok()
        .and_then(|index| samples.get(index))
        .copied()
        .unwrap_or(0.0)
}

impl Takes {
    #[must_use]
    pub const fn new(sample_rate: u32) -> Self {
        Self {
            pieces: Vec::new(),
            live: None,
            segments: Vec::new(),
            stretcher: TimePitch::new(1, sample_rate),
            previous: None,
            current: None,
            scratch: Vec::new(),
        }
    }

    fn layers(&self) -> Vec<&Piece> {
        let live = self.live.iter().flat_map(|live| &live.runs);
        self.pieces
            .iter()
            .chain(live.map(|run| &run.piece))
            .collect()
    }

    fn update(&mut self) {
        self.segments = lay_out(&self.layers());
    }

    pub fn set_pieces(&mut self, pieces: Vec<Piece>, finished_take: Option<&str>, switched: bool) {
        let keep_live = !switched
            && self
                .live
                .as_ref()
                .is_none_or(|live| Some(live.take.as_str()) != finished_take);
        self.pieces = pieces;
        if !keep_live {
            self.live = None;
        }
        self.update();
    }

    pub fn begin_live(&mut self, take: &str, key: TakeKey) {
        if self.live.as_ref().is_some_and(|live| live.take == take) {
            return;
        }
        self.live = Some(Live {
            take: take.to_owned(),
            key,
            runs: Vec::new(),
        });
        self.update();
    }

    #[expect(
        clippy::float_cmp,
        reason = "a chunk goes on a run only when it starts at the very frame of the run, as before"
    )]
    pub fn append_live(&mut self, start_frame: f64, offset: f64, samples: &[f32]) {
        let Some(live) = self.live.as_mut() else {
            return;
        };
        let goes_on = live
            .runs
            .last()
            .is_some_and(|run| offset > 0.0 && run.start_frame == start_frame);
        if !goes_on {
            live.runs.push(LiveRun {
                start_frame,
                first_offset: offset,
                piece: Piece {
                    song_start: start_frame + offset * live.key.tempo,
                    tempo: live.key.tempo,
                    transpose: live.key.transpose,
                    octave: live.key.octave,
                    samples: Vec::new(),
                },
            });
        }
        if let Some(run) = live.runs.last_mut() {
            let at = usize::try_from(whole_to_i64(offset - run.first_offset)).unwrap_or(0);
            let end = at + samples.len();
            if run.piece.samples.len() < end {
                run.piece.samples.resize(end, 0.0);
            }
            run.piece.samples[at..end].copy_from_slice(samples);
        }
        self.update();
    }

    pub fn clear(&mut self) {
        self.set_pieces(Vec::new(), None, true);
    }

    #[must_use]
    pub fn segments(&self) -> &[Segment] {
        &self.segments
    }

    fn render_part(&mut self, output: &mut [f32], part: Part, target: Target) {
        let Some(piece) = piece_at(&self.pieces, self.live.as_ref(), part.segment.piece) else {
            return;
        };
        let (ratio, semitones) = target.shift(piece);
        let stretched = (ratio - 1.0).abs() >= UNIT_RATIO_TOLERANCE || semitones != 0;
        let length = part.to - part.from;
        let continued = self.previous.is_some_and(|previous| {
            previous.piece == part.segment.piece
                && previous.stretched == stretched
                && (previous.song_end - part.song_frame).abs() <= CONTINUITY_FRAMES
        });
        let mapped = whole_to_i64(js_round((part.song_frame - piece.song_start) / piece.tempo));
        let position = match self.previous {
            Some(previous) if continued && !stretched => previous.raw_end,
            _ => mapped,
        };
        self.current = Some(Played {
            piece: part.segment.piece,
            stretched,
            song_end: part.song_frame + frames_to_f64(length) * target.tempo,
            raw_end: position + i64::try_from(length).unwrap_or(0),
        });
        let block = &mut output[part.from..part.to];
        let samples = piece.samples.as_slice();
        if !stretched {
            for (index, sample) in block.iter_mut().enumerate() {
                *sample = raw_sample(samples, position + i64::try_from(index).unwrap_or(0));
            }
            return;
        }
        if !continued {
            self.stretcher.reset();
        }
        self.stretcher.set_tempo(ratio);
        self.stretcher.set_semitones(semitones);
        self.stretcher
            .process(block, position, &mut |fill: Block<'_>| {
                for index in 0..fill.count {
                    let frame = position + fill.offset + i64::try_from(index).unwrap_or(0);
                    fill.samples[index] = raw_sample(samples, frame);
                }
            });
    }

    fn parts(&self, song_frame: f64, tempo: f64, frames: usize) -> Vec<Part> {
        let mut parts = Vec::new();
        let mut offset = 0.0_f64;
        let length = frames_to_f64(frames);
        for segment in &self.segments[first_ending_after(&self.segments, song_frame)..] {
            if offset >= length {
                break;
            }
            let start = offset.max(((segment.start - song_frame) / tempo).ceil());
            let end = length.min(((segment.end - song_frame) / tempo).ceil());
            if start >= length {
                break;
            }
            if end > start {
                parts.push(Part {
                    from: usize::try_from(whole_to_i64(start)).unwrap_or(0),
                    to: usize::try_from(whole_to_i64(end)).unwrap_or(0),
                    segment: *segment,
                    song_frame: song_frame + start * tempo,
                });
            }
            offset = offset.max(end);
        }
        parts
    }

    pub fn render(&mut self, output: &mut [f32], song_frame: f64, target: Target) -> bool {
        self.previous = self.current;
        self.current = None;
        output.fill(0.0);
        let parts = self.parts(song_frame, target.tempo, output.len());
        for part in &parts {
            self.render_part(output, *part, target);
        }
        !parts.is_empty()
    }

    pub fn mix_into(&mut self, output: &mut [f32], frames: usize, mix: TakeMix) -> bool {
        let mut scratch = std::mem::take(&mut self.scratch);
        scratch.resize(frames, 0.0);
        let taken = &mut scratch[..frames];
        let written = self.render(taken, mix.song_frame, mix.target);
        if written {
            for channel in output.chunks_exact_mut(frames) {
                add_gained_into(channel, taken, mix.volume);
            }
        }
        self.scratch = scratch;
        written
    }
}
