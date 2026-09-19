use crate::unit_plan::UnitPlan;

const COUNTER_FLOOR: f64 = 1e-10;
const VALUE_BYTES: usize = 4;

pub(crate) struct FoldAccumulator {
    target: Vec<f32>,
    counter: Vec<f32>,
    channels: u32,
    frames: usize,
}

impl FoldAccumulator {
    #[expect(
        clippy::cast_possible_truncation,
        reason = "signal sizes stay far below the address space"
    )]
    pub(crate) fn create(frames: u64, channels: u32) -> Self {
        let length = frames as usize * channels as usize;
        Self {
            target: vec![0.0; length],
            counter: vec![0.0; length],
            channels,
            frames: frames as usize,
        }
    }

    pub(crate) fn frames(&self) -> u64 {
        self.frames as u64
    }

    pub(crate) fn record_bytes(&self) -> usize {
        record_bytes(self.channels)
    }

    #[expect(
        clippy::cast_possible_truncation,
        reason = "the accumulation reproduces the browser float32 arithmetic"
    )]
    pub(crate) fn add(&mut self, plan: &UnitPlan, index: usize, chunk: &[f32]) {
        let unit = &plan.units()[index];
        let chunk_frames = plan.chunk_samples as usize;
        let channels = self.channels as usize;
        for channel in 0..channels {
            let output_base = channel * self.frames + unit.start as usize;
            let chunk_base = channel * chunk_frames;
            for position in 0..unit.length as usize {
                let weight = f64::from(plan.weight(index, u32::try_from(position).unwrap_or(0)));
                let output = output_base + position;
                let sample = f64::from(chunk[chunk_base + position]);
                self.target[output] = (f64::from(self.target[output]) + sample * weight) as f32;
                self.counter[output] = (f64::from(self.counter[output]) + weight) as f32;
            }
        }
    }

    #[expect(
        clippy::cast_possible_truncation,
        reason = "frame ranges index buffers that fit the address space"
    )]
    pub(crate) fn records(&self, from: u64, to: u64) -> Vec<u8> {
        let channels = self.channels as usize;
        let mut bytes = Vec::with_capacity((to - from) as usize * self.record_bytes());
        for frame in from as usize..to as usize {
            for channel in 0..channels {
                let value = self.target[channel * self.frames + frame];
                bytes.extend_from_slice(&value.to_le_bytes());
            }
            for channel in 0..channels {
                let value = self.counter[channel * self.frames + frame];
                bytes.extend_from_slice(&value.to_le_bytes());
            }
        }
        bytes
    }

    #[expect(
        clippy::cast_possible_truncation,
        reason = "frame ranges index buffers that fit the address space"
    )]
    pub(crate) fn restore(frames: u64, channels: u32, prefix: &[u8], tail: &[u8]) -> Option<Self> {
        let record = record_bytes(channels);
        if !prefix.len().is_multiple_of(record)
            || !tail.len().is_multiple_of(record)
            || (prefix.len() + tail.len()) / record > frames as usize
        {
            return None;
        }
        let mut fold = Self::create(frames, channels);
        fold.load(0, prefix)?;
        fold.load(prefix.len() / record, tail)?;
        Some(fold)
    }

    fn load(&mut self, start: usize, bytes: &[u8]) -> Option<()> {
        let channels = self.channels as usize;
        for (offset, record) in bytes.chunks_exact(self.record_bytes()).enumerate() {
            let frame = start + offset;
            let mut values = record
                .chunks_exact(VALUE_BYTES)
                .map(|raw| raw.try_into().ok().map(f32::from_le_bytes));
            for channel in 0..channels {
                self.target[channel * self.frames + frame] = values.next()??;
            }
            for channel in 0..channels {
                self.counter[channel * self.frames + frame] = values.next()??;
            }
        }
        Some(())
    }

    #[expect(
        clippy::cast_possible_truncation,
        reason = "the division reproduces the browser float32 arithmetic"
    )]
    pub(crate) fn finalize(&self) -> Vec<f32> {
        self.target
            .iter()
            .zip(&self.counter)
            .map(|(value, counter)| {
                (f64::from(*value) / f64::from(*counter).max(COUNTER_FLOOR)) as f32
            })
            .collect()
    }
}

pub(crate) fn record_bytes(channels: u32) -> usize {
    channels as usize * 2 * VALUE_BYTES
}

#[cfg(test)]
mod tests;
