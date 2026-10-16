use std::{f64::consts::PI, sync::Arc};

use rustfft::{Fft, FftPlanner, num_complex::Complex32};

const SMALL_POWER: usize = 16;
const LARGEST_MULTIPLE: usize = 8;
const SLOW_MULTIPLE: usize = 7;

fn fast_complex_size_above(size: usize) -> usize {
    let mut power = 1;
    while power < SMALL_POWER && power < size {
        power *= 2;
    }
    while power * LARGEST_MULTIPLE < size {
        power *= 2;
    }
    let mut multiple = size.div_ceil(power);
    if multiple == SLOW_MULTIPLE {
        multiple += 1;
    }
    multiple * power
}

pub(crate) fn fast_real_size_above(size: usize) -> usize {
    fast_complex_size_above(size.div_ceil(2)) * 2
}

pub(crate) struct HalfBinFft {
    forward: Arc<dyn Fft<f32>>,
    inverse: Arc<dyn Fft<f32>>,
    twiddles: Vec<Complex32>,
    twists: Vec<Complex32>,
    buffer: Vec<Complex32>,
    scratch: Vec<Complex32>,
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "the phase is rounded to f32 before cos and sin, like the original"
)]
fn unit(phase: f64) -> Complex32 {
    let rounded = phase as f32;
    Complex32::new(rounded.cos(), rounded.sin())
}

#[expect(
    clippy::cast_precision_loss,
    reason = "fft sizes are far below the f64 mantissa"
)]
fn to_f64(value: usize) -> f64 {
    value as f64
}

impl HalfBinFft {
    pub(crate) fn new(size: usize) -> Self {
        let half = size / 2;
        let mut planner = FftPlanner::new();
        let forward = planner.plan_fft_forward(half);
        let inverse = planner.plan_fft_inverse(half);
        let scratch_length = forward
            .get_inplace_scratch_len()
            .max(inverse.get_inplace_scratch_len());
        let step = -2.0 * PI / to_f64(size);
        Self {
            forward,
            inverse,
            twiddles: (0..=half / 2)
                .map(|index| unit((to_f64(index) + 0.5) * step - PI / 2.0))
                .collect(),
            twists: (0..half).map(|index| unit(step * to_f64(index))).collect(),
            buffer: vec![Complex32::default(); half],
            scratch: vec![Complex32::default(); scratch_length],
        }
    }

    pub(crate) fn forward(&mut self, time: &[f32], spectrum: &mut [Complex32]) {
        for ((value, twist), pair) in self
            .buffer
            .iter_mut()
            .zip(&self.twists)
            .zip(time.chunks_exact(2))
        {
            let (real, imag) = (pair[0], pair[1]);
            *value = Complex32::new(
                real * twist.re - imag * twist.im,
                imag * twist.re + real * twist.im,
            );
        }
        self.forward
            .process_with_scratch(&mut self.buffer, &mut self.scratch);
        let half = self.buffer.len();
        for (index, twiddle) in self.twiddles.iter().enumerate() {
            let mirror = half - 1 - index;
            let low = self.buffer[index];
            let high = self.buffer[mirror].conj();
            let odd = (low + high) * 0.5;
            let even = (low - high) * 0.5;
            let rotated = Complex32::new(
                even.re * twiddle.re - even.im * twiddle.im,
                even.im * twiddle.re + even.re * twiddle.im,
            );
            spectrum[index] = odd + rotated;
            spectrum[mirror] = Complex32::new(odd.re - rotated.re, rotated.im - odd.im);
        }
    }

    pub(crate) fn inverse(&mut self, spectrum: &[Complex32], time: &mut [f32]) {
        let half = self.buffer.len();
        for (index, twiddle) in self.twiddles.iter().enumerate() {
            let mirror = half - 1 - index;
            let low = spectrum[index];
            let high = spectrum[mirror].conj();
            let odd = low + high;
            let rotated = low - high;
            let even = Complex32::new(
                rotated.re * twiddle.re + rotated.im * twiddle.im,
                rotated.im * twiddle.re - rotated.re * twiddle.im,
            );
            self.buffer[index] = odd + even;
            self.buffer[mirror] = Complex32::new(odd.re - even.re, even.im - odd.im);
        }
        self.inverse
            .process_with_scratch(&mut self.buffer, &mut self.scratch);
        for ((value, twist), pair) in self
            .buffer
            .iter()
            .zip(&self.twists)
            .zip(time.chunks_exact_mut(2))
        {
            pair[0] = value.re * twist.re + value.im * twist.im;
            pair[1] = value.im * twist.re - value.re * twist.im;
        }
    }
}

#[cfg(test)]
mod tests {
    use rustfft::num_complex::Complex32;

    use super::{HalfBinFft, fast_real_size_above};
    use crate::test_signal::{signal, to_float};

    #[test]
    fn picks_the_size_of_the_original_for_a_default_block() {
        assert_eq!(fast_real_size_above(2646) * 2, 6144);
    }

    #[test]
    fn inverse_restores_the_signal_times_the_size() {
        let size = 96;
        let mut fft = HalfBinFft::new(size);
        let time = signal(size);
        let mut spectrum = vec![Complex32::default(); size / 2];
        let mut restored = vec![0.0; size];
        fft.forward(&time, &mut spectrum);
        fft.inverse(&spectrum, &mut restored);
        for (original, value) in time.iter().zip(&restored) {
            assert!((original * to_float(size) - value).abs() < 1e-3);
        }
    }
}
