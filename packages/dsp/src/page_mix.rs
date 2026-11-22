use crate::{BoxedError, mix::add_gained};

pub const FADE_FRAMES: i64 = 256;
pub const READY_MARGIN_FRAMES: i64 = 16_384;
pub const READY_STEP_FRAMES: i64 = 4_096;
pub const OUTPUT_RESERVE_FRAMES: usize = 65_536;

const NO_STEM: &str = "The mixer has no such stem";
const NO_PAGE: &str = "The stem has no such page";
const TOO_LONG: &str = "The page is longer than a slot of the mixer";
const TOO_WIDE: &str = "The page has more channels than the mixer";

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LoopRange {
    pub from: i64,
    pub to: i64,
    pub end: i64,
    pub cycle: bool,
}

impl LoopRange {
    #[must_use]
    pub fn song_frame(&self, frame: i64) -> i64 {
        if !self.cycle || frame < self.to {
            return frame;
        }
        self.from + (frame - self.from).rem_euclid(self.to - self.from)
    }

    #[must_use]
    #[expect(
        clippy::cast_precision_loss,
        reason = "a fade is 256 frames, far below the precision of f32"
    )]
    pub fn gain(&self, song_frame: i64) -> f32 {
        if song_frame >= self.end {
            return 0.0;
        }
        if song_frame < self.from {
            return 1.0;
        }
        let ramp = |distance: i64| {
            if distance < FADE_FRAMES {
                distance.max(0) as f32 / FADE_FRAMES as f32
            } else {
                1.0
            }
        };
        ramp(song_frame - self.from).min(ramp(self.end - song_frame))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PageShape {
    pub stem: usize,
    pub index: usize,
    pub frames: usize,
    pub channels: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MixRequest {
    pub first: i64,
    pub count: usize,
    pub mask: u32,
}

#[derive(Clone, Copy)]
struct Resident {
    slot: usize,
    frames: usize,
    channels: usize,
}

#[derive(Default)]
struct Stem {
    frame_count: i64,
    page_starts: Vec<i64>,
    pages: Vec<Option<Resident>>,
}

impl Stem {
    fn page_of(&self, frame: i64) -> Option<usize> {
        if frame < 0 || frame >= self.frame_count || self.page_starts.is_empty() {
            return None;
        }
        Some(
            self.page_starts
                .partition_point(|start| *start <= frame)
                .saturating_sub(1),
        )
    }

    fn page_end(&self, index: usize) -> i64 {
        self.page_starts
            .get(index + 1)
            .copied()
            .unwrap_or(self.frame_count)
    }

    fn longest_page(&self) -> i64 {
        (0..self.page_starts.len())
            .map(|index| self.page_end(index) - self.page_starts[index])
            .max()
            .unwrap_or(0)
    }
}

fn page_channel(slots: &[Vec<f32>], page: Resident, channel: usize) -> &[f32] {
    let source = channel.min(page.channels - 1);
    &slots[page.slot][source * page.frames..(source + 1) * page.frames]
}

#[derive(Clone, Copy)]
struct StemMix<'mixed> {
    stem: &'mixed Stem,
    volume: f32,
}

#[derive(Clone, Copy)]
struct Span {
    from: usize,
    to: usize,
    offset: usize,
}

struct Output<'mixed> {
    samples: &'mixed mut [f32],
    channels: usize,
    slots: &'mixed [Vec<f32>],
}

impl Output<'_> {
    fn add_page(&mut self, page: Resident, span: Span, volume: f32) {
        let stride = self.samples.len() / self.channels;
        for channel in 0..self.channels {
            let source = &page_channel(self.slots, page, channel)[span.from..span.to];
            let at = channel * stride + span.offset;
            add_gained(
                &mut self.samples[at..at + (span.to - span.from)],
                source,
                volume,
            );
        }
    }

    fn add_run(&mut self, mix: StemMix<'_>, request: MixRequest) {
        let StemMix { stem, volume } = mix;
        let end = request.first + i64::try_from(request.count).unwrap_or(i64::MAX);
        let mut frame = request.first.max(0);
        while frame < end {
            let Some(index) = stem.page_of(frame) else {
                return;
            };
            let start = stem.page_starts[index];
            let stop = stem.page_end(index).min(end);
            if let Some(page) = stem.pages[index] {
                let span = Span {
                    from: usize::try_from(frame - start).unwrap_or(0),
                    to: usize::try_from(stop - start).unwrap_or(0),
                    offset: usize::try_from(frame - request.first).unwrap_or(0),
                };
                self.add_page(page, span, volume);
            }
            frame = stop;
        }
    }

    fn add_range(&mut self, mix: StemMix<'_>, range: &LoopRange, request: MixRequest) {
        let StemMix { stem, volume } = mix;
        let stride = self.samples.len() / self.channels;
        for offset in 0..request.count {
            let frame = request.first + i64::try_from(offset).unwrap_or(0);
            let song_frame = range.song_frame(frame);
            let Some((index, page)) = stem
                .page_of(song_frame)
                .and_then(|index| stem.pages[index].map(|page| (index, page)))
            else {
                continue;
            };
            let at = usize::try_from(song_frame - stem.page_starts[index]).unwrap_or(0);
            let gain = range.gain(song_frame);
            for channel in 0..self.channels {
                let sample = page_channel(self.slots, page, channel)[at];
                self.samples[channel * stride + offset] += sample * volume * gain;
            }
        }
    }
}

pub struct PageMixer {
    channels: usize,
    slot_frames: usize,
    slots: Vec<Vec<f32>>,
    free: Vec<usize>,
    stems: Vec<Stem>,
    range: Option<LoopRange>,
    output: Vec<f32>,
}

impl PageMixer {
    #[must_use]
    pub fn new(channels: usize, stem_count: usize) -> Self {
        Self {
            channels,
            slot_frames: 0,
            slots: Vec::new(),
            free: Vec::new(),
            stems: (0..stem_count).map(|_| Stem::default()).collect(),
            range: None,
            output: Vec::with_capacity(channels * OUTPUT_RESERVE_FRAMES),
        }
    }

    pub fn set_stem(
        &mut self,
        stem: usize,
        frame_count: i64,
        page_starts: &[i64],
    ) -> Result<(), BoxedError> {
        self.release_stem(stem)?;
        let target = self.stems.get_mut(stem).ok_or(NO_STEM)?;
        target.frame_count = frame_count;
        target.page_starts = page_starts.to_vec();
        target.pages = vec![None; page_starts.len()];
        let longest = usize::try_from(target.longest_page())?;
        if longest > self.slot_frames {
            self.slot_frames = longest;
            self.slots.clear();
            self.free.clear();
            for other in &mut self.stems {
                other.pages.iter_mut().for_each(|page| *page = None);
            }
        }
        Ok(())
    }

    pub fn reserve_pages(&mut self, count: usize) {
        while self.slots.len() < count {
            self.free.push(self.slots.len());
            self.slots.push(vec![0.0; self.slot_frames * self.channels]);
        }
    }

    fn release_stem(&mut self, stem: usize) -> Result<(), BoxedError> {
        let target = self.stems.get_mut(stem).ok_or(NO_STEM)?;
        for page in target.pages.iter_mut().filter_map(Option::take) {
            self.free.push(page.slot);
        }
        Ok(())
    }

    pub fn page_input(&mut self, shape: PageShape) -> Result<&mut [f32], BoxedError> {
        if shape.frames > self.slot_frames {
            return Err(TOO_LONG.into());
        }
        if shape.channels == 0 || shape.channels > self.channels {
            return Err(TOO_WIDE.into());
        }
        self.drop_page(shape.stem, shape.index)?;
        let slot = if let Some(slot) = self.free.pop() {
            slot
        } else {
            self.slots.push(vec![0.0; self.slot_frames * self.channels]);
            self.slots.len() - 1
        };
        let target = self.stems.get_mut(shape.stem).ok_or(NO_STEM)?;
        *target.pages.get_mut(shape.index).ok_or(NO_PAGE)? = Some(Resident {
            slot,
            frames: shape.frames,
            channels: shape.channels,
        });
        Ok(&mut self.slots[slot][..shape.frames * shape.channels])
    }

    #[must_use]
    pub fn page_frames(&self, stem: usize, index: usize) -> Option<usize> {
        let target = self.stems.get(stem)?;
        let start = *target.page_starts.get(index)?;
        usize::try_from(target.page_end(index) - start).ok()
    }

    pub fn drop_page(&mut self, stem: usize, index: usize) -> Result<(), BoxedError> {
        let target = self.stems.get_mut(stem).ok_or(NO_STEM)?;
        if let Some(page) = target.pages.get_mut(index).and_then(Option::take) {
            self.free.push(page.slot);
        }
        Ok(())
    }

    pub fn set_range(&mut self, range: Option<LoopRange>) {
        self.range = range;
    }

    #[must_use]
    pub fn ready(&self, frame: i64) -> bool {
        let mut at = frame - READY_MARGIN_FRAMES;
        while at <= frame + READY_MARGIN_FRAMES {
            let song_frame = self.range.map_or(at, |range| range.song_frame(at));
            let resident = self.stems.iter().all(|stem| {
                stem.page_of(song_frame)
                    .is_none_or(|index| stem.pages[index].is_some())
            });
            if !resident {
                return false;
            }
            at += READY_STEP_FRAMES;
        }
        true
    }

    pub fn mix(&mut self, request: MixRequest, volumes: &[f32]) -> &[f32] {
        self.output.clear();
        self.output.resize(request.count * self.channels, 0.0);
        let mut output = Output {
            samples: &mut self.output,
            channels: self.channels,
            slots: &self.slots,
        };
        for (index, stem) in self.stems.iter().enumerate() {
            if request.mask & (1 << index) == 0 {
                continue;
            }
            let mix = StemMix {
                stem,
                volume: volumes.get(index).copied().unwrap_or(1.0),
            };
            match &self.range {
                None => output.add_run(mix, request),
                Some(range) => output.add_range(mix, range, request),
            }
        }
        &self.output
    }
}
