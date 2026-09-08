use crate::unit_plan::UnitPlan;

const COUNTER_FLOOR: f64 = 1e-10;

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

    pub(crate) fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity((self.target.len() + self.counter.len()) * 4);
        for value in self.target.iter().chain(&self.counter) {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        bytes
    }

    #[expect(
        clippy::cast_possible_truncation,
        reason = "signal sizes stay far below the address space"
    )]
    pub(crate) fn from_bytes(bytes: &[u8], frames: u64, channels: u32) -> Option<Self> {
        let length = frames as usize * channels as usize;
        if bytes.len() != length * 8 {
            return None;
        }
        let mut target = Vec::with_capacity(length);
        let mut counter = Vec::with_capacity(length);
        for raw in bytes[..length * 4].chunks_exact(4) {
            target.push(f32::from_le_bytes(raw.try_into().ok()?));
        }
        for raw in bytes[length * 4..].chunks_exact(4) {
            counter.push(f32::from_le_bytes(raw.try_into().ok()?));
        }
        Some(Self {
            target,
            counter,
            channels,
            frames: frames as usize,
        })
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

#[cfg(test)]
mod tests;
