use std::f64::consts::PI;

const BESSEL_PRECISION: f64 = 1e-4;

fn bessel_zero(x: f64) -> f64 {
    let mut result = 0.0;
    let mut term = 1.0;
    let mut order = 0.0;
    while term > BESSEL_PRECISION {
        result += term;
        order += 1.0;
        term *= (x * x) / (4.0 * order * order);
    }
    result
}

fn kaiser_beta(bandwidth: f64) -> f64 {
    let tuned = bandwidth
        + 8.0 / ((bandwidth + 3.0) * (bandwidth + 3.0))
        + 0.25 * (3.0 - bandwidth).max(0.0);
    let clamped = tuned.max(2.0);
    (clamped * clamped * 0.25 - 1.0).sqrt() * PI
}

#[expect(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    reason = "window lengths are far below the f64 mantissa and the window is stored as f32"
)]
pub(crate) fn kaiser(length: usize, interval: usize) -> Vec<f32> {
    let beta = kaiser_beta(length as f64 / interval as f64);
    let inverse_peak = 1.0 / bessel_zero(beta);
    let inverse_length = 1.0 / length as f64;
    let mut window: Vec<f32> = (0..length)
        .map(|index| {
            let position = (2 * index + 1) as f64 * inverse_length - 1.0;
            (bessel_zero(beta * (1.0 - position * position).sqrt()) * inverse_peak) as f32
        })
        .collect();
    reconstruct_perfectly(&mut window, interval);
    window
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "the window is stored as f32, like the original"
)]
fn reconstruct_perfectly(window: &mut [f32], interval: usize) {
    for start in 0..interval {
        let energy: f64 = window
            .iter()
            .skip(start)
            .step_by(interval)
            .map(|value| f64::from(value * value))
            .sum();
        let factor = 1.0 / energy.sqrt();
        for value in window.iter_mut().skip(start).step_by(interval) {
            *value = (f64::from(*value) * factor) as f32;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::kaiser;

    #[test]
    fn overlapping_squares_sum_to_one() {
        let interval = 25;
        let window = kaiser(100, interval);
        for start in 0..interval {
            let sum: f32 = window
                .iter()
                .skip(start)
                .step_by(interval)
                .map(|value| value * value)
                .sum();
            assert!((sum - 1.0).abs() < 1e-5);
        }
    }

    #[test]
    fn is_symmetric() {
        let window = kaiser(64, 16);
        for (left, right) in window.iter().zip(window.iter().rev()) {
            assert!((left - right).abs() < 1e-6);
        }
    }
}
