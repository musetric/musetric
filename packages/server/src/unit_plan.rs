use std::collections::BTreeMap;

const TAU: f64 = 2.0 * std::f64::consts::PI;

const VOCALS_HOP: u32 = 441;
const VOCALS_FRAMES: u32 = 1100;
const VOCALS_STEP_SECONDS: u32 = 8;

const LEAD_BACKING_N_FFT: u32 = 5120;
const LEAD_BACKING_HOP: u32 = 1024;
const LEAD_BACKING_FRAMES: u32 = 256;
const LEAD_BACKING_OVERLAP: f64 = 0.25;
pub(crate) const LEAD_BACKING_COMPENSATE: f64 = 1.065;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum PlanRules {
    VocalsV1,
    LeadBackingV1,
}

pub(crate) struct PlanUnit {
    pub(crate) start: u64,
    pub(crate) length: u32,
}

pub(crate) struct UnitPlan {
    pub(crate) rules: PlanRules,
    pub(crate) channels: u32,
    pub(crate) chunk_samples: u32,
    units: Vec<PlanUnit>,
    tables: BTreeMap<u32, Vec<f32>>,
}

pub(crate) struct LeadBackingLayout {
    pub(crate) trim: u32,
    pub(crate) mixture_samples: u64,
}

impl UnitPlan {
    pub(crate) fn create(
        rules: PlanRules,
        channels: u32,
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
            PlanRules::LeadBackingV1 => {
                if length == 1 {
                    return vec![1.0];
                }
                (0..length)
                    .map(|position| {
                        (0.5 - 0.5 * (TAU * f64::from(position) / f64::from(length - 1)).cos())
                            as f32
                    })
                    .collect()
            }
        }
    }

    #[expect(
        clippy::cast_possible_truncation,
        reason = "the traversal mirrors the browser loop over non-negative offsets"
    )]
    pub(crate) fn vocals(sample_rate: u32, samples: u64) -> Self {
        let chunk_samples = VOCALS_HOP * (VOCALS_FRAMES - 1);
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
        Self::create(PlanRules::VocalsV1, 2, chunk_samples, units)
    }

    #[expect(
        clippy::cast_sign_loss,
        clippy::cast_possible_truncation,
        reason = "the traversal mirrors the browser loop over non-negative offsets"
    )]
    pub(crate) fn lead_backing(samples: u64) -> (Self, LeadBackingLayout) {
        let chunk_samples = LEAD_BACKING_HOP * (LEAD_BACKING_FRAMES - 1);
        let trim = LEAD_BACKING_N_FFT / 2;
        let gen_samples = chunk_samples - 2 * trim;
        let mixture_samples = 2 * u64::from(trim) + samples + u64::from(gen_samples)
            - samples % u64::from(gen_samples);
        let step = ((1.0 - LEAD_BACKING_OVERLAP) * f64::from(chunk_samples)) as u64;
        let mut units = Vec::new();
        let mut start = 0_u64;
        while start < mixture_samples {
            let length = u64::from(chunk_samples).min(mixture_samples - start);
            units.push(PlanUnit {
                start,
                length: length as u32,
            });
            start += step;
        }
        (
            Self::create(PlanRules::LeadBackingV1, 2, chunk_samples, units),
            LeadBackingLayout {
                trim,
                mixture_samples,
            },
        )
    }

    pub(crate) fn units(&self) -> &[PlanUnit] {
        &self.units
    }

    pub(crate) fn unit_count(&self) -> u32 {
        u32::try_from(self.units.len()).unwrap_or(0)
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
        let channels = self.channels as usize;
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
}

#[cfg(test)]
mod tests;
