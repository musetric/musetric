use super::{
    CHANNELS, QUANTUM,
    time_pitch::{Block, TimePitch, frames_to_f64, js_round, whole_to_i64},
};
use crate::stretch::StretchStream;

const UNIT_RATIO_TOLERANCE: f64 = 1e-6;
const LANES: usize = 2;
const RESERVED_PARTS: usize = 16;
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
    take: u32,
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
    stretched: bool,
    sounding: bool,
}

impl Part {
    fn continues(&self, last: Option<Played>) -> bool {
        last.is_some_and(|played| {
            played.piece == self.segment.piece
                && played.stretched == self.stretched
                && (played.song_end - self.song_frame).abs() <= CONTINUITY_FRAMES
        })
    }

    fn played(&self, position: i64, tempo: f64) -> Played {
        let length = self.to - self.from;
        Played {
            piece: self.segment.piece,
            stretched: self.stretched,
            song_end: self.song_frame + frames_to_f64(length) * tempo,
            raw_end: position + i64::try_from(length).unwrap_or(0),
        }
    }
}

#[derive(Clone, Copy)]
struct Routed {
    part: Part,
    lane: usize,
    continued: bool,
}

struct Lane {
    stretcher: TimePitch,
    previous: Option<Played>,
    current: Option<Played>,
}

pub struct Takes {
    pieces: Vec<Piece>,
    live: Option<Live>,
    segments: Vec<Segment>,
    lanes: [Lane; LANES],
    raw_previous: Option<Played>,
    raw_current: Option<Played>,
    lead: usize,
    scratch: Vec<f32>,
    lead_scratch: Vec<f32>,
    parts: Vec<Part>,
    plan: Vec<Option<Routed>>,
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
        || pieces.iter().any(|piece| is_stretched(target, piece))
}

fn is_stretched(target: Target, piece: &Piece) -> bool {
    let (ratio, semitones) = target.shift(piece);
    (ratio - 1.0).abs() >= UNIT_RATIO_TOLERANCE || semitones != 0
}

#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "an offset into a quantum is a small whole number that is not negative"
)]
const fn to_index(offset: f64) -> usize {
    offset as usize
}

fn free_lane(last: &[Option<Played>; LANES], later: &[Part]) -> usize {
    let reserved = |lane: usize| {
        later
            .iter()
            .any(|part| part.stretched && part.continues(last[lane]))
    };
    (0..LANES)
        .filter(|lane| !reserved(*lane))
        .min_by_key(|lane| last[*lane].is_some())
        .unwrap_or(0)
}

fn add_gained_into(channel: &mut [f32], take: &[f32], volume: f32) {
    for (sample, value) in channel.iter_mut().zip(take) {
        *sample += value * volume;
    }
}

fn write_gained_into(channel: &mut [f32], take: &[f32], volume: f32) {
    for (sample, value) in channel.iter_mut().zip(take) {
        *sample = value * volume;
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
    pub fn new(sample_rate: u32) -> Self {
        let lane = || {
            let mut stretcher = TimePitch::new(1, sample_rate);
            stretcher.reserve(QUANTUM);
            Lane {
                stretcher,
                previous: None,
                current: None,
            }
        };
        Self {
            pieces: Vec::new(),
            live: None,
            segments: Vec::new(),
            lanes: [lane(), lane()],
            raw_previous: None,
            raw_current: None,
            lead: StretchStream::new(1, sample_rate).output_latency(),
            scratch: Vec::with_capacity(QUANTUM),
            lead_scratch: Vec::with_capacity(QUANTUM),
            parts: Vec::with_capacity(RESERVED_PARTS),
            plan: Vec::with_capacity(RESERVED_PARTS),
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

    pub fn set_pieces(&mut self, pieces: Vec<Piece>, finished_take: Option<u32>, switched: bool) {
        let keep_live = !switched
            && self
                .live
                .as_ref()
                .is_none_or(|live| Some(live.take) != finished_take);
        self.pieces = pieces;
        if !keep_live {
            self.live = None;
        }
        self.update();
    }

    pub fn begin_live(&mut self, take: u32, key: TakeKey) {
        if self.live.as_ref().is_some_and(|live| live.take == take) {
            return;
        }
        self.live = Some(Live {
            take,
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

    fn stretched(&self, piece: usize, target: Target) -> bool {
        piece_at(&self.pieces, self.live.as_ref(), piece)
            .is_some_and(|found| is_stretched(target, found))
    }

    fn sounding_parts(
        &self,
        song_frame: f64,
        target: Target,
        frames: usize,
    ) -> impl Iterator<Item = Part> {
        let tempo = target.tempo;
        let mut offset = 0.0_f64;
        let length = frames_to_f64(frames);
        self.segments[first_ending_after(&self.segments, song_frame)..]
            .iter()
            .map_while(move |segment| {
                let start = offset.max(((segment.start - song_frame) / tempo).ceil());
                let end = length.min(((segment.end - song_frame) / tempo).ceil());
                if start >= length {
                    return None;
                }
                offset = offset.max(end);
                Some((end > start).then(|| Part {
                    from: to_index(start),
                    to: to_index(end),
                    segment: *segment,
                    song_frame: song_frame + start * tempo,
                    stretched: self.stretched(segment.piece, target),
                    sounding: true,
                }))
            })
            .flatten()
    }

    fn lead_ins(
        &self,
        song_frame: f64,
        target: Target,
        frames: usize,
    ) -> impl Iterator<Item = Part> {
        let tempo = target.tempo;
        let length = frames_to_f64(frames);
        let span = frames_to_f64(self.lead) * tempo;
        let reach = song_frame + length * tempo + span;
        let first = self
            .segments
            .partition_point(|segment| segment.start <= song_frame);
        self.segments[first..]
            .iter()
            .take_while(move |segment| segment.start < reach)
            .filter(move |segment| self.stretched(segment.piece, target))
            .filter_map(move |segment| {
                let start = ((segment.start - span - song_frame) / tempo)
                    .ceil()
                    .max(0.0);
                let end = length.min(((segment.start - song_frame) / tempo).ceil());
                (end > start).then(|| Part {
                    from: to_index(start),
                    to: to_index(end),
                    segment: *segment,
                    song_frame: song_frame + start * tempo,
                    stretched: true,
                    sounding: false,
                })
            })
    }

    fn route(&self, parts: &[Part], target: Target, planned: &mut Vec<Option<Routed>>) {
        let mut last = self.lanes.each_ref().map(|lane| lane.previous);
        for (index, part) in parts.iter().enumerate() {
            if !part.stretched {
                planned.push(None);
                continue;
            }
            let routed = match (0..LANES).find(|lane| part.continues(last[*lane])) {
                Some(lane) => Routed {
                    part: *part,
                    lane,
                    continued: true,
                },
                None => Routed {
                    part: *part,
                    lane: free_lane(&last, &parts[index + 1..]),
                    continued: false,
                },
            };
            last[routed.lane] = Some(part.played(0, target.tempo));
            planned.push(Some(routed));
        }
    }

    fn render_stretched(&mut self, block: &mut [f32], routed: Routed, target: Target) {
        let Routed {
            part,
            lane: chosen,
            continued,
        } = routed;
        let Some(piece) = piece_at(&self.pieces, self.live.as_ref(), part.segment.piece) else {
            return;
        };
        let (ratio, semitones) = target.shift(piece);
        let position = whole_to_i64(js_round((part.song_frame - piece.song_start) / piece.tempo));
        let lane = &mut self.lanes[chosen];
        lane.current = Some(part.played(position, target.tempo));
        if !continued {
            lane.stretcher.reset();
        }
        lane.stretcher.set_tempo(ratio);
        lane.stretcher.set_semitones(semitones);
        let samples = piece.samples.as_slice();
        lane.stretcher
            .process(block, position, &mut |fill: Block<'_>| {
                for index in 0..fill.count {
                    let frame = position + fill.offset + i64::try_from(index).unwrap_or(0);
                    fill.samples[index] = raw_sample(samples, frame);
                }
            });
    }

    fn render_raw(&mut self, block: &mut [f32], part: Part, target: Target) {
        let Some(piece) = piece_at(&self.pieces, self.live.as_ref(), part.segment.piece) else {
            return;
        };
        let mapped = whole_to_i64(js_round((part.song_frame - piece.song_start) / piece.tempo));
        let position = match self.raw_previous {
            Some(previous) if part.continues(Some(previous)) => previous.raw_end,
            _ => mapped,
        };
        self.raw_current = Some(part.played(position, target.tempo));
        for (index, sample) in block.iter_mut().enumerate() {
            *sample = raw_sample(&piece.samples, position + i64::try_from(index).unwrap_or(0));
        }
    }

    pub fn render(&mut self, output: &mut [f32], song_frame: f64, target: Target) -> bool {
        for lane in &mut self.lanes {
            lane.previous = lane.current.take();
        }
        self.raw_previous = self.raw_current.take();
        output.fill(0.0);
        let frames = output.len();
        let mut parts = std::mem::take(&mut self.parts);
        parts.clear();
        parts.extend(self.sounding_parts(song_frame, target, frames));
        let written = !parts.is_empty();
        parts.extend(self.lead_ins(song_frame, target, frames));
        parts.sort_by_key(|part| part.from);
        let mut plan = std::mem::take(&mut self.plan);
        plan.clear();
        self.route(&parts, target, &mut plan);
        let mut lead = std::mem::take(&mut self.lead_scratch);
        lead.resize(frames, 0.0);
        for (part, step) in parts.iter().zip(plan.iter().copied()) {
            let block = if part.sounding {
                &mut output[part.from..part.to]
            } else {
                &mut lead[part.from..part.to]
            };
            match step {
                Some(routed) => self.render_stretched(block, routed, target),
                None => self.render_raw(block, *part, target),
            }
        }
        self.lead_scratch = lead;
        self.parts = parts;
        self.plan = plan;
        written
    }

    #[must_use]
    pub fn sounding(&self) -> bool {
        !self.segments.is_empty()
    }

    pub fn mix_into(&mut self, output: &mut [f32], mix: TakeMix) {
        self.put_into(output, mix, add_gained_into);
    }

    pub fn write_into(&mut self, output: &mut [f32], mix: TakeMix) {
        self.put_into(output, mix, write_gained_into);
    }

    fn put_into(&mut self, output: &mut [f32], mix: TakeMix, put: fn(&mut [f32], &[f32], f32)) {
        let frames = output.len() / CHANNELS;
        let mut scratch = std::mem::take(&mut self.scratch);
        scratch.resize(frames, 0.0);
        let taken = &mut scratch[..frames];
        self.render(taken, mix.song_frame, mix.target);
        for channel in output.chunks_exact_mut(frames) {
            put(channel, taken, mix.volume);
        }
        self.scratch = scratch;
    }
}
