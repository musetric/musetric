use crate::SAMPLE_BITS;

pub(crate) const SAMPLE_BYTES: usize = SAMPLE_BITS / 8;

const FULL_SCALE: f32 = 32_768.0;
const UNIFORM_STEPS: f32 = 65_536.0;
const SEED: u32 = 0x9e37_79b9;

pub(crate) struct Dither {
    state: u32,
}

impl Dither {
    pub(crate) const fn create() -> Self {
        Self { state: SEED }
    }

    fn uniform(&mut self) -> f32 {
        self.state ^= self.state << 13;
        self.state ^= self.state >> 17;
        self.state ^= self.state << 5;
        let [high, low, ..] = self.state.to_be_bytes();
        f32::from(u16::from_be_bytes([high, low])) / UNIFORM_STEPS
    }

    #[expect(
        clippy::cast_possible_truncation,
        reason = "the value is clamped to the sample range before it is truncated"
    )]
    pub(crate) fn quantize(&mut self, value: f32) -> i16 {
        if value == 0.0 {
            return 0;
        }
        let noise = self.uniform() - self.uniform();
        (value * FULL_SCALE + noise)
            .round()
            .clamp(-FULL_SCALE, FULL_SCALE - 1.0) as i16
    }
}
