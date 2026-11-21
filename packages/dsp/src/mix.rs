pub const PEAK_CEILING: f32 = 0.891_250_9;

pub fn limit_peak(mixed: &mut [f32]) {
    let peak = mixed
        .iter()
        .fold(0.0_f32, |peak, value| peak.max(value.abs()));
    if peak <= PEAK_CEILING {
        return;
    }
    let scale = PEAK_CEILING / peak;
    for value in mixed {
        *value *= scale;
    }
}

pub fn add_gained(target: &mut [f32], source: &[f32], gain: f32) {
    for (sum, sample) in target.iter_mut().zip(source) {
        *sum += *sample * gain;
    }
}
