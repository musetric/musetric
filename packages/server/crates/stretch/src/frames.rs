use rustfft::num_complex::Complex32;

use crate::{
    fourier::{HalfBinFft, fast_real_size_above},
    window::kaiser,
};

const ALMOST_ZERO: f32 = 1e-30;

pub(crate) struct Stft {
    channels: usize,
    block: usize,
    fft_size: usize,
    interval: usize,
    offset: usize,
    input_length: usize,
    input: Vec<f32>,
    input_position: usize,
    output: Vec<f32>,
    window_products: Vec<f32>,
    output_position: usize,
    spectrum: Vec<Complex32>,
    time: Vec<f32>,
    window: Vec<f32>,
    fft: HalfBinFft,
}

#[expect(
    clippy::cast_precision_loss,
    reason = "fft sizes are far below the f32 mantissa"
)]
fn to_float(value: usize) -> f32 {
    value as f32
}

const fn time_slot(index: usize, offset: usize, fft_size: usize) -> (usize, f32) {
    if index < offset {
        (index + fft_size - offset, -1.0)
    } else {
        (index - offset, 1.0)
    }
}

impl Stft {
    pub(crate) fn new(channels: usize, block: usize, interval: usize) -> Self {
        let fft_size = fast_real_size_above(block.div_ceil(2)) * 2;
        let input_length = block + interval + 1;
        Self {
            channels,
            block,
            fft_size,
            interval,
            offset: block / 2,
            input_length,
            input: vec![0.0; input_length * channels],
            input_position: block,
            output: vec![0.0; block * channels],
            window_products: vec![0.0; block],
            output_position: 0,
            spectrum: vec![Complex32::default(); fft_size / 2 * channels],
            time: vec![0.0; fft_size],
            window: kaiser(block, interval),
            fft: HalfBinFft::new(fft_size),
        }
    }

    pub(crate) const fn block(&self) -> usize {
        self.block
    }

    pub(crate) const fn interval(&self) -> usize {
        self.interval
    }

    pub(crate) const fn fft_size(&self) -> usize {
        self.fft_size
    }

    pub(crate) const fn bands(&self) -> usize {
        self.fft_size / 2
    }

    pub(crate) const fn analysis_latency(&self) -> usize {
        self.block - self.offset
    }

    pub(crate) const fn synthesis_latency(&self) -> usize {
        self.offset
    }

    pub(crate) fn band_to_frequency(&self, band: f32) -> f32 {
        (band + 0.5) / to_float(self.fft_size)
    }

    pub(crate) fn frequency_to_band(&self, frequency: f32) -> f32 {
        frequency * to_float(self.fft_size) - 0.5
    }

    pub(crate) fn reset(&mut self, product_weight: f32) {
        self.input_position = self.block;
        self.output_position = 0;
        self.input.fill(0.0);
        self.output.fill(0.0);
        self.spectrum.fill(Complex32::default());
        self.window_products.fill(0.0);
        self.add_window_product();
        for index in (0..self.block - self.interval).rev() {
            self.window_products[index] += self.window_products[index + self.interval];
        }
        for product in &mut self.window_products {
            *product = *product * product_weight + ALMOST_ZERO;
        }
        self.move_output(self.interval);
    }

    pub(crate) fn write_input(&mut self, channel: usize, values: impl Iterator<Item = f32>) {
        let start = channel * self.input_length;
        for (index, value) in values.enumerate() {
            let position = (self.input_position + index) % self.input_length;
            self.input[start + position] = value;
        }
    }

    pub(crate) fn move_input(&mut self, samples: usize) {
        self.input_position = (self.input_position + samples) % self.input_length;
    }

    pub(crate) fn read_output(&self, channel: usize, offset: usize, target: &mut [f32]) {
        let start = channel * self.block;
        for (index, value) in target.iter_mut().enumerate() {
            let position = (self.output_position + offset + index) % self.block;
            *value = self.output[start + position] / self.window_products[position];
        }
    }

    pub(crate) fn read_output_sample(&self, channel: usize) -> f32 {
        self.output[channel * self.block + self.output_position]
            / self.window_products[self.output_position]
    }

    pub(crate) fn move_output(&mut self, samples: usize) {
        for index in 0..samples {
            let position = (self.output_position + index) % self.block;
            for channel in 0..self.channels {
                self.output[channel * self.block + position] = 0.0;
            }
            self.window_products[position] = ALMOST_ZERO;
        }
        self.output_position = (self.output_position + samples) % self.block;
    }

    pub(crate) fn finish_output(&mut self) {
        let mut largest = 0.0_f32;
        for index in 0..self.block {
            let product = &mut self.window_products[(self.output_position + index) % self.block];
            largest = largest.max(*product);
            *product += largest - *product;
        }
    }

    pub(crate) fn spectrum(&self, channel: usize) -> &[Complex32] {
        let bands = self.bands();
        &self.spectrum[channel * bands..(channel + 1) * bands]
    }

    pub(crate) fn spectrum_mut(&mut self, channel: usize) -> &mut [Complex32] {
        let bands = self.bands();
        &mut self.spectrum[channel * bands..(channel + 1) * bands]
    }

    pub(crate) fn analyse(&mut self, samples_in_past: usize) {
        let bands = self.bands();
        let start = (self.input_length * 2 + self.input_position - self.block - samples_in_past)
            % self.input_length;
        for channel in 0..self.channels {
            let buffer =
                &self.input[channel * self.input_length..(channel + 1) * self.input_length];
            for (index, weight) in self.window.iter().enumerate() {
                let (slot, sign) = time_slot(index, self.offset, self.fft_size);
                self.time[slot] = buffer[(start + index) % self.input_length] * (weight * sign);
            }
            self.time[self.block - self.offset..self.fft_size - self.offset].fill(0.0);
            self.fft.forward(
                &self.time,
                &mut self.spectrum[channel * bands..(channel + 1) * bands],
            );
        }
    }

    pub(crate) fn synthesise(&mut self) {
        let bands = self.bands();
        self.add_window_product();
        for channel in 0..self.channels {
            self.fft.inverse(
                &self.spectrum[channel * bands..(channel + 1) * bands],
                &mut self.time,
            );
            let buffer = &mut self.output[channel * self.block..(channel + 1) * self.block];
            for (index, weight) in self.window.iter().enumerate() {
                let (slot, sign) = time_slot(index, self.offset, self.fft_size);
                buffer[(self.output_position + index) % self.block] +=
                    self.time[slot] * (weight * sign);
            }
        }
    }

    fn add_window_product(&mut self) {
        let scale = to_float(self.fft_size);
        for (index, weight) in self.window.iter().enumerate() {
            let position = (self.output_position + index) % self.block;
            self.window_products[position] += weight * weight * scale;
        }
    }
}
