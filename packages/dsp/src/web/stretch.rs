use wasm_bindgen::prelude::{JsError, wasm_bindgen};

use crate::{
    CHANNELS,
    stretch::{Refusal, Stretch},
};

const TOO_SHORT: &str = "The audio is too short to change its tempo or key";
const STOPPED: &str = "The stretch was stopped";

#[wasm_bindgen]
pub struct Stretcher {
    sample_rate: u32,
    semitones: i32,
    keep_formants: bool,
}

#[wasm_bindgen]
impl Stretcher {
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new(sample_rate: u32, semitones: i32, keep_formants: bool) -> Stretcher {
        Self {
            sample_rate,
            semitones,
            keep_formants,
        }
    }

    pub fn apply(&self, samples: &[f32], frame_count: usize) -> Result<Vec<f32>, JsError> {
        let channels: Vec<Vec<f32>> = (0..CHANNELS)
            .map(|channel| {
                samples
                    .iter()
                    .skip(channel)
                    .step_by(CHANNELS)
                    .copied()
                    .collect()
            })
            .collect();
        let stretch = Stretch {
            sample_rate: self.sample_rate,
            frame_count,
            semitones: self.semitones,
            keep_formants: self.keep_formants,
        };
        let stretched =
            stretch
                .apply(&channels, &mut |_| true)
                .map_err(|refusal| match refusal {
                    Refusal::TooShort => JsError::new(TOO_SHORT),
                    Refusal::Stopped => JsError::new(STOPPED),
                })?;
        let mut interleaved = Vec::with_capacity(frame_count * CHANNELS);
        for frame in 0..frame_count {
            for channel in &stretched {
                interleaved.push(channel[frame]);
            }
        }
        Ok(interleaved)
    }
}
