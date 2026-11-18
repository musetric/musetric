use std::f32::consts::FRAC_1_SQRT_2;

const MEAN_WEIGHT: f32 = 0.5;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Downmix {
    Power,
    Mean,
}

impl Downmix {
    #[must_use]
    pub fn apply(self, left: f32, right: f32) -> f32 {
        (left + right) * self.weight()
    }

    fn weight(self) -> f32 {
        match self {
            Self::Power => FRAC_1_SQRT_2,
            Self::Mean => MEAN_WEIGHT,
        }
    }
}
