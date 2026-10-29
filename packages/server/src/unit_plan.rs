use std::collections::BTreeMap;

use crate::analysis::models::{VOCALS_GEOMETRY, VOCALS_MASKS};

const TAU: f64 = 2.0 * std::f64::consts::PI;

const VOCALS_STEP_SECONDS: u32 = 8;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum PlanRules {
    VocalsV1,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct PlanChannels {
    pub(crate) input: u32,
    pub(crate) output: u32,
}

pub(crate) struct PlanUnit {
    pub(crate) start: u64,
    pub(crate) length: u32,
}

pub(crate) struct UnitPlan {
    pub(crate) rules: PlanRules,
    pub(crate) channels: PlanChannels,
    pub(crate) chunk_samples: u32,
    units: Vec<PlanUnit>,
    tables: BTreeMap<u32, Vec<f32>>,
}

impl UnitPlan {
    pub(crate) fn create(
        rules: PlanRules,
        channels: PlanChannels,
        chunk_samples: u32,
        units: Vec<PlanUnit>,
    ) -> Self {
        let mut lengths: Vec<u32> = units.iter().map(|unit| unit.length).collect();
        lengths.sort_unstable();
        lengths.dedup();
        let tables = lengths
            .into_iter()
            .map(|length| (length, Self::table(rules, length, chunk_samples)))
            .collect();
        Self {
            rules,
            channels,
            chunk_samples,
            units,
            tables,
        }
    }

    #[expect(
        clippy::cast_possible_truncation,
        reason = "window tables hold exactly representable window weights"
    )]
    fn table(rules: PlanRules, length: u32, chunk_samples: u32) -> Vec<f32> {
        match rules {
            PlanRules::VocalsV1 => (0..length)
                .map(|position| {
                    (0.54 - 0.46 * (TAU * f64::from(position) / f64::from(chunk_samples)).cos())
                        as f32
                })
                .collect(),
        }
    }

    #[expect(
        clippy::cast_possible_truncation,
        reason = "the traversal mirrors the browser loop over non-negative offsets"
    )]
    pub(crate) fn vocals(sample_rate: u32, samples: u64) -> Self {
        let chunk_samples = VOCALS_GEOMETRY.chunk_samples;
        let step = u64::from(VOCALS_STEP_SECONDS * sample_rate).min(u64::from(chunk_samples));
        let mut units = Vec::new();
        let mut offset = 0_u64;
        while offset < samples {
            let unit = if offset + u64::from(chunk_samples) <= samples {
                PlanUnit {
                    start: offset,
                    length: chunk_samples,
                }
            } else if samples >= u64::from(chunk_samples) {
                PlanUnit {
                    start: samples - u64::from(chunk_samples),
                    length: chunk_samples,
                }
            } else {
                PlanUnit {
                    start: 0,
                    length: samples as u32,
                }
            };
            units.push(unit);
            offset += step;
        }
        Self::create(
            PlanRules::VocalsV1,
            PlanChannels {
                input: VOCALS_GEOMETRY.channels,
                output: VOCALS_GEOMETRY.channels * VOCALS_MASKS,
            },
            chunk_samples,
            units,
        )
    }

    pub(crate) fn units(&self) -> &[PlanUnit] {
        &self.units
    }

    pub(crate) fn unit_count(&self) -> u32 {
        u32::try_from(self.units.len()).unwrap_or(0)
    }

    pub(crate) fn settled_frames(&self, next_unit: usize, frames: u64) -> u64 {
        self.units[next_unit..]
            .iter()
            .map(|unit| unit.start)
            .min()
            .unwrap_or(frames)
            .min(frames)
    }

    pub(crate) fn reached_frames(&self, next_unit: usize, frames: u64) -> u64 {
        self.units[..next_unit]
            .iter()
            .map(|unit| unit.start + u64::from(unit.length))
            .max()
            .unwrap_or(0)
            .min(frames)
    }

    #[must_use]
    pub(crate) fn weight(&self, index: usize, position: u32) -> f32 {
        let length = self.units[index].length;
        let table = &self.tables[&length];
        table[position as usize]
    }

    #[expect(
        clippy::cast_possible_truncation,
        reason = "window placement indexes planar buffers that fit the address space"
    )]
    pub(crate) fn window_bytes(&self, input: &[f32], index: usize) -> Vec<u8> {
        let unit = &self.units[index];
        let frames = self.chunk_samples as usize;
        let channels = self.channels.input as usize;
        let input_frames = input.len() / channels;
        let mut chunk = vec![0_f32; channels * frames];
        for channel in 0..channels {
            let source = channel * input_frames + unit.start as usize;
            let target = channel * frames;
            chunk[target..target + unit.length as usize]
                .copy_from_slice(&input[source..source + unit.length as usize]);
        }
        chunk.iter().copied().flat_map(f32::to_le_bytes).collect()
    }

    pub(crate) fn output_bytes(&self) -> u64 {
        u64::from(self.chunk_samples) * u64::from(self.channels.output) * 4
    }
}

#[cfg(test)]
mod tests;
