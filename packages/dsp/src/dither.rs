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

#[cfg(test)]
mod tests {
    use super::{Dither, FULL_SCALE};

    #[test]
    fn keeps_digital_silence_silent() {
        let mut dither = Dither::create();

        assert!((0..1000).all(|_| dither.quantize(0.0) == 0));
    }

    #[test]
    fn spreads_the_rounding_of_a_quiet_signal_within_one_step() {
        let mut dither = Dither::create();
        let value = 0.25 / FULL_SCALE;

        let samples: Vec<i16> = (0..100_000).map(|_| dither.quantize(value)).collect();

        let mean = samples.iter().map(|&sample| f64::from(sample)).sum::<f64>() / 100_000.0;
        assert!(samples.iter().all(|&sample| (-1..=1).contains(&sample)));
        assert!((mean - 0.25).abs() < 0.01, "the mean is {mean}");
    }

    #[test]
    fn clamps_a_full_scale_signal() {
        let mut dither = Dither::create();

        assert_eq!(dither.quantize(2.0), i16::MAX);
        assert_eq!(dither.quantize(-2.0), i16::MIN);
    }
}
