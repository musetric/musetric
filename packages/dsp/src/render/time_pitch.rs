use crate::stretch::{Planar, PlanarMut, StretchStream};

const CONTINUITY_FRAMES: i64 = 4;

pub struct Block<'block> {
    pub samples: &'block mut [f32],
    pub stride: usize,
    pub offset: i64,
    pub count: usize,
}

pub type Fill<'fill> = &'fill mut dyn FnMut(Block<'_>);

#[must_use]
pub fn js_round(value: f64) -> f64 {
    let floor = value.floor();
    if value - floor >= 0.5 {
        floor + 1.0
    } else {
        floor
    }
}

#[expect(
    clippy::cast_precision_loss,
    reason = "a block of frames is far below the f64 mantissa"
)]
pub(crate) const fn frames_to_f64(frames: usize) -> f64 {
    frames as f64
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "a rounded frame of a song is far below i64::MAX"
)]
pub(crate) const fn whole_to_i64(value: f64) -> i64 {
    value as i64
}

#[derive(Clone, Copy)]
struct Cursor {
    tempo: f64,
    head: i64,
    next_input: i64,
}

struct Stretcher {
    stream: StretchStream,
    channels: usize,
    length: usize,
    semitones: i32,
    formants: bool,
    input: Vec<f32>,
    output: Vec<f32>,
}

impl Stretcher {
    fn new(channels: usize, sample_rate: u32, frames: usize) -> Self {
        let stream = StretchStream::new(channels, sample_rate);
        let length = frames.max(stream.seek_length());
        Self {
            stream,
            channels,
            length,
            semitones: 0,
            formants: false,
            input: vec![0.0; channels * length],
            output: vec![0.0; channels * length],
        }
    }

    fn clear_input(&mut self, count: usize) {
        for channel in 0..self.channels {
            let start = channel * self.length;
            self.input[start..start + count].fill(0.0);
        }
    }

    fn prime(&mut self, input_frame: i64, tempo: f64, fill: Fill<'_>) -> Cursor {
        let latency = js_round(frames_to_f64(self.stream.output_latency()) * tempo);
        let head_offset =
            whole_to_i64(latency) + i64::try_from(self.stream.input_latency()).unwrap_or(0);
        self.input.fill(0.0);
        let length = i64::try_from(self.length).unwrap_or(i64::MAX);
        fill(Block {
            samples: &mut self.input,
            stride: self.length,
            offset: head_offset - length,
            count: self.length,
        });
        self.stream.seek(
            &Planar {
                samples: &self.input,
                stride: self.length,
                frames: self.length,
            },
            tempo,
        );
        Cursor {
            tempo,
            head: input_frame + head_offset,
            next_input: input_frame,
        }
    }
}

pub struct TimePitch {
    sample_rate: u32,
    channels: usize,
    stretcher: Option<Stretcher>,
    cursor: Option<Cursor>,
    fraction: f64,
    semitones: i32,
    tempo: f64,
    formants: bool,
}

impl TimePitch {
    #[must_use]
    pub const fn new(channels: usize, sample_rate: u32) -> Self {
        Self {
            sample_rate,
            channels,
            stretcher: None,
            cursor: None,
            fraction: 0.0,
            semitones: 0,
            tempo: 1.0,
            formants: false,
        }
    }

    pub fn reset(&mut self) {
        if let Some(stretcher) = &mut self.stretcher {
            stretcher.stream.reset();
        }
        self.cursor = None;
        self.fraction = 0.0;
    }

    pub const fn refill(&mut self) {
        self.cursor = None;
    }

    pub const fn set_semitones(&mut self, semitones: i32) {
        self.semitones = semitones;
    }

    pub const fn set_tempo(&mut self, tempo: f64) {
        self.tempo = tempo;
    }

    pub const fn set_formants(&mut self, formants: bool) {
        self.formants = formants;
    }

    #[expect(
        clippy::float_cmp,
        reason = "the player passes a tempo of exactly 1 to bypass the stretch, as before"
    )]
    const fn bypassed(&self) -> bool {
        self.semitones == 0 && self.tempo == 1.0
    }

    fn input_count(&mut self, frames: usize) -> usize {
        let raw = frames_to_f64(frames) * self.tempo;
        let count = (raw + self.fraction).floor();
        self.fraction += raw - count;
        usize::try_from(whole_to_i64(count)).unwrap_or(0)
    }

    fn prepare(&mut self, frames: usize) {
        if self
            .stretcher
            .as_ref()
            .is_none_or(|stretcher| stretcher.length < frames)
        {
            self.cursor = None;
            self.stretcher = Some(Stretcher::new(self.channels, self.sample_rate, frames));
        }
        let (semitones, formants) = (self.semitones, self.formants);
        if let Some(stretcher) = self.stretcher.as_mut() {
            if stretcher.semitones != semitones {
                stretcher.stream.set_semitones(semitones);
                stretcher.semitones = semitones;
            }
            if stretcher.formants != formants {
                stretcher.stream.set_keep_formants(formants);
                stretcher.formants = formants;
            }
        }
    }

    #[expect(
        clippy::float_cmp,
        reason = "a stream goes on only at the very tempo it was primed with, as before"
    )]
    fn goes_on(&self, input_frame: i64) -> Option<Cursor> {
        self.cursor.filter(|cursor| {
            cursor.tempo == self.tempo
                && (input_frame - cursor.next_input).abs() <= CONTINUITY_FRAMES
        })
    }

    pub fn advance(&mut self, frames: usize) -> usize {
        if self.bypassed() {
            self.cursor = None;
            return frames;
        }
        self.input_count(frames)
    }

    pub fn process(&mut self, output: &mut [f32], input_frame: i64, fill: Fill<'_>) -> usize {
        let frames = output.len() / self.channels;
        if self.bypassed() {
            self.cursor = None;
            fill(Block {
                samples: output,
                stride: frames,
                offset: 0,
                count: frames,
            });
            return frames;
        }
        let count = self.input_count(frames);
        let tempo = self.tempo;
        self.prepare(frames.max(count));
        let going = self.goes_on(input_frame);
        let Some(stretcher) = self.stretcher.as_mut() else {
            return count;
        };
        let cursor = going.unwrap_or_else(|| stretcher.prime(input_frame, tempo, fill));
        stretcher.clear_input(count);
        fill(Block {
            samples: &mut stretcher.input,
            stride: stretcher.length,
            offset: cursor.head - input_frame,
            count,
        });
        stretcher.stream.process(
            &Planar {
                samples: &stretcher.input,
                stride: stretcher.length,
                frames: count,
            },
            &mut PlanarMut {
                samples: &mut stretcher.output,
                stride: stretcher.length,
                frames,
            },
        );
        let taken = i64::try_from(count).unwrap_or(0);
        self.cursor = Some(Cursor {
            tempo,
            head: cursor.head + taken,
            next_input: input_frame + taken,
        });
        for channel in 0..self.channels {
            let from = channel * stretcher.length;
            output[channel * frames..(channel + 1) * frames]
                .copy_from_slice(&stretcher.output[from..from + frames]);
        }
        count
    }
}
