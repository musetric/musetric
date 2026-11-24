mod takes;
mod time_pitch;
mod whole;

pub use takes::{Piece, Segment, TakeKey, TakeMix, Takes, Target, lay_out, stretches};
pub use time_pitch::{Block, Fill, TimePitch, js_round};
pub use whole::{QUANTUM, Song, StemLayout, StemPages, render_song};

use crate::page_mix::{LoopRange, MixRequest, PageMixer};

pub const CHANNELS: usize = 2;
pub const STEM_COUNT: usize = 3;
pub const ALL_STEMS: u32 = 0b111;
pub const ACCOMPANIMENT: u32 = 0b110;
pub const LEAD: u32 = 0b001;
const SEMITONES_PER_OCTAVE: i32 = 12;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Parts {
    pub song: bool,
    pub takes: bool,
    pub lead: bool,
}

impl Parts {
    #[must_use]
    pub const fn channels(self) -> usize {
        if self.song || self.lead { CHANNELS } else { 1 }
    }

    pub const ALL: Self = Self {
        song: true,
        takes: true,
        lead: true,
    };
    pub const SONG: Self = Self {
        song: true,
        takes: false,
        lead: false,
    };
    pub const TAKES: Self = Self {
        song: false,
        takes: true,
        lead: false,
    };
    pub const LEAD: Self = Self {
        song: false,
        takes: false,
        lead: true,
    };
}

pub struct Renderer {
    mixer: PageMixer,
    volumes: Vec<f32>,
    song: TimePitch,
    lead: TimePitch,
    takes: Takes,
    target: Target,
    recording_volume: f32,
    lead_output: Vec<f32>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Quantum {
    pub frame: i64,
    pub take_frame: Option<f64>,
}

struct StemFill<'fill> {
    mixer: &'fill mut PageMixer,
    volumes: &'fill [f32],
    frame: i64,
    mask: u32,
}

impl StemFill<'_> {
    fn fill(&mut self, block: &mut Block<'_>) {
        let mixed = self.mixer.mix(
            MixRequest {
                first: self.frame + block.offset,
                count: block.count,
                mask: self.mask,
            },
            self.volumes,
        );
        for channel in 0..CHANNELS {
            let source = channel * block.count;
            let target = channel * block.stride;
            block.samples[target..target + block.count]
                .copy_from_slice(&mixed[source..source + block.count]);
        }
    }
}

fn add_into(output: &mut [f32], source: &[f32]) {
    for (sample, value) in output.iter_mut().zip(source) {
        *sample += value;
    }
}

impl Renderer {
    #[must_use]
    pub fn new(sample_rate: u32) -> Self {
        let mut song = TimePitch::new(CHANNELS, sample_rate);
        song.reserve(QUANTUM);
        let mut lead = TimePitch::new(CHANNELS, sample_rate);
        lead.set_formants(true);
        lead.reserve(QUANTUM);
        Self {
            mixer: PageMixer::new(CHANNELS, STEM_COUNT),
            volumes: vec![1.0; STEM_COUNT],
            song,
            lead,
            takes: Takes::new(sample_rate),
            target: Target::ORIGINAL,
            recording_volume: 1.0,
            lead_output: Vec::with_capacity(CHANNELS * QUANTUM),
        }
    }

    pub const fn mixer(&mut self) -> &mut PageMixer {
        &mut self.mixer
    }

    pub const fn takes(&mut self) -> &mut Takes {
        &mut self.takes
    }

    pub fn set_volumes(&mut self, volumes: &[f32]) {
        volumes.clone_into(&mut self.volumes);
    }

    pub fn set_range(&mut self, range: Option<LoopRange>) {
        self.mixer.set_range(range);
    }

    pub const fn set_recording_volume(&mut self, volume: f32) {
        self.recording_volume = volume;
    }

    const fn voice_shift(&self) -> i32 {
        if self.target.voice_shifted {
            SEMITONES_PER_OCTAVE * self.target.voice_octave
        } else {
            0
        }
    }

    pub const fn set_tempo(&mut self, tempo: f64) {
        self.target.tempo = tempo;
        self.song.set_tempo(tempo);
        self.lead.set_tempo(tempo);
    }

    pub const fn set_transpose(&mut self, semitones: i32) {
        self.target.transpose = semitones;
        self.song.set_semitones(semitones);
        self.lead.set_semitones(semitones + self.voice_shift());
    }

    pub const fn set_voice(&mut self, octave: i32, shifted: bool) {
        self.target.voice_octave = octave;
        self.target.voice_shifted = shifted;
        self.lead
            .set_semitones(self.target.transpose + self.voice_shift());
    }

    #[must_use]
    pub const fn target(&self) -> Target {
        self.target
    }

    pub fn reset(&mut self) {
        self.song.reset();
        self.lead.reset();
    }

    pub const fn refill(&mut self) {
        self.song.refill();
        self.lead.refill();
    }

    #[must_use]
    pub const fn lead_apart(&self) -> bool {
        self.voice_shift() != 0
    }

    pub fn render(&mut self, quantum: Quantum, output: &mut [f32]) -> usize {
        self.render_parts(Parts::ALL, quantum, output)
    }

    pub fn render_parts(&mut self, parts: Parts, quantum: Quantum, output: &mut [f32]) -> usize {
        let Quantum { frame, take_frame } = quantum;
        let frames = output.len() / CHANNELS;
        let lead_apart = self.lead_apart();
        let Self {
            mixer,
            volumes,
            song,
            lead,
            takes,
            target,
            recording_volume,
            lead_output,
        } = self;
        output.fill(0.0);
        let processed = if parts.song {
            let mask = if lead_apart { ACCOMPANIMENT } else { ALL_STEMS };
            let mut stems = StemFill {
                mixer,
                volumes,
                frame,
                mask,
            };
            song.process(output, frame, &mut |mut block: Block<'_>| {
                stems.fill(&mut block);
            })
        } else {
            song.advance(frames)
        };
        let mut sung = false;
        if parts.takes
            && takes.sounding()
            && let Some(song_frame) = take_frame
        {
            let mix = TakeMix {
                song_frame,
                target: *target,
                volume: *recording_volume,
            };
            if parts.song {
                takes.mix_into(output, mix);
            } else {
                takes.write_into(output, mix);
            }
            sung = true;
        }
        if parts.lead && lead_apart {
            lead_output.clear();
            lead_output.resize(output.len(), 0.0);
            let mut stems = StemFill {
                mixer,
                volumes,
                frame,
                mask: LEAD,
            };
            lead.process(lead_output, frame, &mut |mut block: Block<'_>| {
                stems.fill(&mut block);
            });
            if parts.song || sung {
                add_into(output, lead_output);
            } else {
                output.copy_from_slice(lead_output);
            }
        }
        processed
    }
}
