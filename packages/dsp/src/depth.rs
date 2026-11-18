#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SampleDepth {
    Sixteen,
    TwentyFour,
}

impl SampleDepth {
    #[must_use]
    pub const fn bits(self) -> usize {
        match self {
            Self::Sixteen => 16,
            Self::TwentyFour => 24,
        }
    }

    pub(crate) const fn bytes(self) -> usize {
        self.bits() / 8
    }

    #[expect(
        clippy::cast_possible_truncation,
        reason = "the value is clamped to the sample range before it is truncated"
    )]
    pub(crate) fn quantize(self, value: f32) -> i32 {
        let scale = self.scale();
        (value * scale).round().clamp(-scale, scale - 1.0) as i32
    }

    const fn scale(self) -> f32 {
        match self {
            Self::Sixteen => 32_768.0,
            Self::TwentyFour => 8_388_608.0,
        }
    }
}
