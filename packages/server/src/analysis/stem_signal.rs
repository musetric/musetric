pub(crate) const CHANNELS: usize = 2;
pub(crate) const MAX_PEAK: f64 = 0.9;

fn peak_of(samples: &[f32]) -> f64 {
    samples
        .iter()
        .fold(0.0, |peak, value| peak.max(f64::from(value.abs())))
}

pub(crate) fn normalize_peak(samples: &[f32], max_peak: f64) -> Vec<f32> {
    let peak = peak_of(samples);
    let scale = if peak == 0.0 || peak <= max_peak {
        1.0
    } else {
        max_peak / peak
    };
    apply_scale(samples, scale)
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "the scale reproduces the browser float32 arithmetic"
)]
fn apply_scale(samples: &[f32], scale: f64) -> Vec<f32> {
    samples
        .iter()
        .map(|value| (f64::from(*value) * scale) as f32)
        .collect()
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "the subtraction reproduces the browser float32 arithmetic"
)]
pub(crate) fn subtract_planar(left: &[f32], right: &[f32]) -> Vec<f32> {
    left.iter()
        .zip(right)
        .map(|(one, other)| (f64::from(*one) - f64::from(*other)) as f32)
        .collect()
}

pub(crate) fn planar_from_interleaved(interleaved: &[f32]) -> Vec<f32> {
    let frames = interleaved.len() / CHANNELS;
    let mut planar = vec![0.0; interleaved.len()];
    for (index, frame) in interleaved.as_chunks::<CHANNELS>().0.iter().enumerate() {
        for (channel, sample) in frame.iter().enumerate() {
            planar[channel * frames + index] = *sample;
        }
    }
    planar
}

pub(crate) fn interleaved_from_planar(planar: &[f32]) -> Vec<u8> {
    let frames = planar.len() / CHANNELS;
    let mut interleaved = Vec::with_capacity(planar.len() * 4);
    for frame in 0..frames {
        for channel in 0..CHANNELS {
            interleaved.extend_from_slice(&planar[channel * frames + frame].to_le_bytes());
        }
    }
    interleaved
}

pub(crate) fn deinterleave(bytes: &[u8]) -> Vec<f32> {
    bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|value| f32::from_le_bytes(*value))
        .collect()
}
