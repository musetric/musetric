use std::ops::{Add, Mul, Sub};

use rustfft::num_complex::Complex32;

use crate::frames::Stft;

const NOISE_FLOOR: f32 = 1e-15;
const TINY: f32 = 1e-30;
const MAX_CLEAN_STRETCH: f32 = 2.0;
const PRODUCT_WEIGHT: f32 = 0.1;
const BLOCK_SECONDS: f64 = 0.12;
const INTERVAL_SECONDS: f64 = 0.03;
const TONALITY_LIMIT_HZ: f32 = 8000.0;
const RANDOM_MULTIPLIER: u64 = 48_271;
const RANDOM_MODULUS: u64 = 2_147_483_647;

#[expect(
    clippy::cast_precision_loss,
    reason = "band and frame indices stay far below the f32 mantissa within one block"
)]
fn to_float(value: usize) -> f32 {
    value as f32
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "band positions are small, the cast mirrors the integer conversion of the original"
)]
fn to_index(value: f32) -> i64 {
    value as i64
}

fn to_signed(value: usize) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

fn to_unsigned(value: i64) -> usize {
    usize::try_from(value).unwrap_or(0)
}

#[expect(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "frame counts of a song fit the f64 mantissa and the rounded position is not negative"
)]
fn input_position(output_index: usize, input_length: usize, output_length: usize) -> usize {
    (output_index as f64 * input_length as f64 / output_length as f64).round() as usize
}

#[derive(Clone, Copy, Default)]
struct Band {
    input: Complex32,
    previous: Complex32,
    output: Complex32,
    input_energy: f32,
}

#[derive(Clone, Copy, Default)]
struct Prediction {
    energy: f32,
    input: Complex32,
}

impl Prediction {
    fn make_output(self, phase: Complex32) -> Complex32 {
        let norm = phase.norm_sqr();
        if norm <= NOISE_FLOOR {
            return self.input * (self.energy / (self.input.norm_sqr() + NOISE_FLOOR)).sqrt();
        }
        phase * (self.energy / norm).sqrt()
    }
}

#[derive(Clone, Copy)]
struct MapPoint {
    input_band: f32,
    gradient: f32,
}

#[derive(Clone, Copy)]
struct Peak {
    input: f32,
    output: f32,
}

struct Random(u64);

impl Random {
    #[expect(
        clippy::cast_precision_loss,
        reason = "a uniform draw only needs f32 precision"
    )]
    fn between(&mut self, low: f32, high: f32) -> f32 {
        self.0 = self.0 * RANDOM_MULTIPLIER % RANDOM_MODULUS;
        let unit = (self.0 - 1) as f32 / (RANDOM_MODULUS - 1) as f32;
        low + (high - low) * unit
    }
}

struct BlockPlan {
    new_spectrum: bool,
    reanalyse: bool,
    time_factor: f32,
}

struct Steps {
    time_factor: f32,
    random_low: Option<f32>,
    long_step: usize,
}

struct Cursor {
    copied: usize,
    previous_offset: i64,
    seeking: bool,
    seek_time_factor: f32,
}

pub(crate) struct Settings {
    pub(crate) channels: usize,
    pub(crate) sample_rate: u32,
    pub(crate) semitones: i32,
    pub(crate) keep_formants: bool,
}

pub(crate) struct Engine {
    stft: Stft,
    channels: usize,
    bands: usize,
    bins: Vec<Band>,
    predictions: Vec<Prediction>,
    map: Vec<MapPoint>,
    peaks: Vec<Peak>,
    energy: Vec<f32>,
    smoothed: Vec<f32>,
    formants: Vec<f32>,
    multiplier: f32,
    tonality_limit: f32,
    mapped: bool,
    keep_formants: bool,
    estimate_weighted: f32,
    estimate_weight: f32,
    random: Random,
}

#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "the block and interval follow the integer conversion of the original preset"
)]
fn preset_frames(sample_rate: u32, seconds: f64) -> usize {
    (f64::from(sample_rate) * seconds) as usize
}

#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    reason = "the multiplier is stored as f32, like the original, and a few semitones are exact in f32"
)]
fn semitones_to_multiplier(semitones: i32) -> f32 {
    2.0_f64.powf(f64::from(semitones as f32 / 12.0)) as f32
}

#[expect(
    clippy::cast_precision_loss,
    reason = "audio sample rates are exact in f32"
)]
fn tonality_limit(sample_rate: u32, multiplier: f32) -> f32 {
    TONALITY_LIMIT_HZ / sample_rate as f32 / multiplier.sqrt()
}

impl Engine {
    pub(crate) fn new(settings: &Settings) -> Self {
        let mut stft = Stft::new(
            settings.channels,
            preset_frames(settings.sample_rate, BLOCK_SECONDS),
            preset_frames(settings.sample_rate, INTERVAL_SECONDS),
        );
        stft.reset(PRODUCT_WEIGHT);
        let bands = stft.bands();
        let multiplier = semitones_to_multiplier(settings.semitones);
        Self {
            stft,
            channels: settings.channels,
            bands,
            bins: vec![Band::default(); bands * settings.channels],
            predictions: vec![Prediction::default(); bands * settings.channels],
            map: vec![
                MapPoint {
                    input_band: 0.0,
                    gradient: 1.0
                };
                bands
            ],
            peaks: Vec::with_capacity(bands / 2),
            energy: vec![0.0; bands],
            smoothed: vec![0.0; bands],
            formants: vec![0.0; bands + 2],
            multiplier,
            tonality_limit: tonality_limit(settings.sample_rate, multiplier),
            mapped: settings.semitones != 0,
            keep_formants: settings.keep_formants,
            estimate_weighted: 0.0,
            estimate_weight: 0.0,
            random: Random(1),
        }
    }

    pub(crate) fn exact(
        &mut self,
        input: &[Vec<f32>],
        output_length: usize,
    ) -> Option<Vec<Vec<f32>>> {
        let latency = self.stft.synthesis_latency();
        if output_length < latency * 2 {
            return None;
        }
        let input_length = input.first().map_or(0, Vec::len);
        let rate = to_float(input_length) / to_float(output_length);
        let seek_time_factor = self.seek(input, rate);
        let mut output = vec![vec![0.0; output_length]; self.channels];
        self.process(input, seek_time_factor, &mut output);
        for channel in &mut output {
            fold_start(channel, latency);
        }
        self.flush(&mut output, latency);
        Some(output)
    }

    #[expect(
        clippy::cast_possible_truncation,
        reason = "the time factor is stored as f32, like the original"
    )]
    fn seek(&mut self, input: &[Vec<f32>], rate: f32) -> f32 {
        let samples = self.stft.analysis_latency();
        let length = self.stft.block() + self.stft.interval();
        let pad = length - samples;
        for (channel, source) in input.iter().enumerate() {
            self.stft.write_input(
                channel,
                (0..length).map(|index| {
                    index
                        .checked_sub(pad)
                        .and_then(|position| source.get(position).copied())
                        .unwrap_or(0.0)
                }),
            );
        }
        self.stft.move_input(length);
        let interval = to_float(self.stft.interval());
        if f64::from(rate) * f64::from(interval) > 1.0 {
            (1.0 / f64::from(rate)) as f32
        } else {
            interval
        }
    }

    fn process(&mut self, input: &[Vec<f32>], seek_time_factor: f32, output: &mut [Vec<f32>]) {
        let input_length = input.first().map_or(0, Vec::len);
        let output_length = output.first().map_or(0, Vec::len);
        let mut cursor = Cursor {
            copied: 0,
            previous_offset: -1,
            seeking: true,
            seek_time_factor,
        };
        for output_index in 0..output_length {
            if output_index % self.stft.interval() == 0 {
                let offset = input_position(output_index, input_length, output_length);
                self.start_block(input, &mut cursor, offset);
            }
            for (channel, samples) in output.iter_mut().enumerate() {
                samples[output_index] = self.stft.read_output_sample(channel);
            }
            self.stft.move_output(1);
        }
    }

    fn start_block(&mut self, input: &[Vec<f32>], cursor: &mut Cursor, offset: usize) {
        let interval = self.stft.interval();
        let input_interval = to_signed(offset) - cursor.previous_offset;
        cursor.previous_offset = to_signed(offset);
        self.copy_input(input, &mut cursor.copied, offset);
        let time_factor = if cursor.seeking {
            cursor.seek_time_factor
        } else {
            to_float(interval) / to_float(to_unsigned(input_interval.max(1)))
        };
        let plan = BlockPlan {
            new_spectrum: cursor.seeking || input_interval > 0,
            reanalyse: cursor.seeking || (input_interval - to_signed(interval)).abs() > 1,
            time_factor,
        };
        cursor.seeking = false;
        self.process_block(&plan);
    }

    fn copy_input(&mut self, input: &[Vec<f32>], copied: &mut usize, to_index: usize) {
        let latency = self.stft.analysis_latency();
        let length = (self.stft.block() + self.stft.interval()).min(to_index - *copied);
        let start = to_index - length;
        for (channel, source) in input.iter().enumerate() {
            self.stft.write_input(
                channel,
                (start..to_index).map(|index| source.get(latency + index).copied().unwrap_or(0.0)),
            );
        }
        self.stft.move_input(length);
        *copied = to_index;
    }

    fn process_block(&mut self, plan: &BlockPlan) {
        if plan.new_spectrum {
            if plan.reanalyse {
                self.stft.analyse(self.stft.interval());
                self.load_spectrum(|bin, value| bin.previous = value);
            }
            self.stft.analyse(0);
            self.load_spectrum(|bin, value| bin.input = value);
        }
        self.process_spectrum(plan);
        for (channel, bins) in self.bins.chunks_exact(self.bands).enumerate() {
            for (value, bin) in self.stft.spectrum_mut(channel).iter_mut().zip(bins) {
                *value = bin.output;
            }
        }
        self.stft.synthesise();
    }

    fn load_spectrum(&mut self, write: fn(&mut Band, Complex32)) {
        for (channel, bins) in self.bins.chunks_exact_mut(self.bands).enumerate() {
            for (bin, value) in bins.iter_mut().zip(self.stft.spectrum(channel)) {
                write(bin, *value);
            }
        }
    }

    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "the long step is a small positive band count"
    )]
    fn process_spectrum(&mut self, plan: &BlockPlan) {
        let smoothing = to_float(self.stft.fft_size()) / to_float(self.stft.interval());
        let time_factor = plan.time_factor.max(1.0 / MAX_CLEAN_STRETCH);
        let steps = Steps {
            time_factor,
            random_low: (time_factor > MAX_CLEAN_STRETCH)
                .then_some(MAX_CLEAN_STRETCH * 2.0 - time_factor),
            long_step: smoothing.round() as usize,
        };
        if plan.new_spectrum {
            self.rotate();
        }
        if self.mapped {
            self.smooth_energy(smoothing);
            self.find_peaks();
            self.update_map();
        } else {
            self.keep_map();
        }
        if self.mapped && self.keep_formants {
            self.update_formants();
        }
        for channel in 0..self.channels {
            self.predict_channel(channel);
        }
        for band in 0..self.bands {
            self.predict_band(band, &steps);
        }
        if plan.new_spectrum {
            for bin in &mut self.bins {
                bin.previous = bin.input;
            }
        }
    }

    fn rotate(&mut self) {
        let interval = to_float(self.stft.interval());
        let turn = 2.0 * std::f32::consts::PI;
        let first = self.stft.band_to_frequency(0.0);
        let step = self.stft.band_to_frequency(1.0) - first;
        let start = Complex32::from_polar(1.0, first * interval * turn);
        let delta = Complex32::from_polar(1.0, step * interval * turn);
        for bins in self.bins.chunks_exact_mut(self.bands) {
            let mut rotation = start;
            for bin in bins {
                bin.output *= rotation;
                bin.previous *= rotation;
                rotation *= delta;
            }
        }
    }

    fn smooth_energy(&mut self, smoothing: f32) {
        let slew = 1.0 / (1.0 + smoothing * 0.5);
        self.energy.fill(0.0);
        for bins in self.bins.chunks_exact_mut(self.bands) {
            for (bin, total) in bins.iter_mut().zip(&mut self.energy) {
                let energy = bin.input.norm_sqr();
                bin.input_energy = energy;
                *total += energy;
            }
        }
        self.smoothed.copy_from_slice(&self.energy);
        let mut level = 0.0;
        for _ in 0..2 {
            for value in self.smoothed.iter_mut().rev() {
                level += (*value - level) * slew;
                *value = level;
            }
            for value in &mut self.smoothed {
                level += (*value - level) * slew;
                *value = level;
            }
        }
    }

    fn map_frequency(&self, frequency: f32) -> f32 {
        if frequency > self.tonality_limit {
            return frequency + (self.multiplier - 1.0) * self.tonality_limit;
        }
        frequency * self.multiplier
    }

    fn find_peaks(&mut self) {
        self.peaks.clear();
        let mut start = 0;
        while start < self.bands {
            if self.energy[start] > self.smoothed[start] {
                start = self.add_peak(start);
            }
            start += 1;
        }
    }

    fn add_peak(&mut self, start: usize) -> usize {
        let mut end = start;
        let mut band_sum = 0.0;
        let mut energy_sum = 0.0;
        while end < self.bands && self.energy[end] > self.smoothed[end] {
            band_sum += to_float(end) * self.energy[end];
            energy_sum += self.energy[end];
            end += 1;
        }
        let average = band_sum / energy_sum;
        let frequency = self.map_frequency(self.stft.band_to_frequency(average));
        self.peaks.push(Peak {
            input: average,
            output: self.stft.frequency_to_band(frequency),
        });
        end
    }

    fn keep_map(&mut self) {
        for bin in &mut self.bins {
            bin.input_energy = bin.input.norm_sqr();
        }
        for (band, point) in self.map.iter_mut().enumerate() {
            *point = MapPoint {
                input_band: to_float(band),
                gradient: 1.0,
            };
        }
    }

    fn update_map(&mut self) {
        let (Some(first), Some(last)) = (self.peaks.first().copied(), self.peaks.last().copied())
        else {
            self.keep_map_points();
            return;
        };
        let bands = to_signed(self.bands);
        let bottom = first.input - first.output;
        for band in 0..bands.min(to_index(first.output.ceil())) {
            self.map[to_unsigned(band)] = MapPoint {
                input_band: to_float(to_unsigned(band)) + bottom,
                gradient: 1.0,
            };
        }
        for index in 1..self.peaks.len() {
            self.interpolate_map(self.peaks[index - 1], self.peaks[index]);
        }
        let top = last.input - last.output;
        for band in to_index(last.output).max(0)..bands {
            self.map[to_unsigned(band)] = MapPoint {
                input_band: to_float(to_unsigned(band)) + top,
                gradient: 1.0,
            };
        }
    }

    fn keep_map_points(&mut self) {
        for (band, point) in self.map.iter_mut().enumerate() {
            *point = MapPoint {
                input_band: to_float(band),
                gradient: 1.0,
            };
        }
    }

    fn interpolate_map(&mut self, previous: Peak, next: Peak) {
        let range_scale = 1.0 / (next.output - previous.output);
        let output_offset = previous.input - previous.output;
        let output_scale = next.input - next.output - previous.input + previous.output;
        let gradient_scale = output_scale * range_scale;
        let start = to_index(previous.output.ceil()).max(0);
        let end = to_signed(self.bands).min(to_index(next.output.ceil()));
        for band in start..end {
            let position = to_float(to_unsigned(band));
            let ratio = (position - previous.output) * range_scale;
            let curve = ratio * ratio * (3.0 - 2.0 * ratio);
            let slope = 6.0 * ratio * (1.0 - ratio);
            self.map[to_unsigned(band)] = MapPoint {
                input_band: position + output_offset + curve * output_scale,
                gradient: 1.0 + slope * gradient_scale,
            };
        }
    }

    fn update_formants(&mut self) {
        self.formants.fill(0.0);
        for bins in self.bins.chunks_exact(self.bands) {
            for (bin, value) in bins.iter().zip(&mut self.formants) {
                *value += bin.input_energy;
            }
        }
        let estimate = self.estimate_frequency();
        for value in &mut self.formants[..self.bands] {
            *value = value.sqrt();
        }
        self.smooth_formants(estimate);
        for band in 0..self.bands {
            let input_frequency = self.stft.band_to_frequency(to_float(band));
            let target_band = self
                .stft
                .frequency_to_band(self.map_frequency(input_frequency));
            let ratio = self.formant_at(target_band) / (self.formants[band] + TINY);
            let energy_ratio = ratio * ratio;
            for channel in 0..self.channels {
                self.bins[channel * self.bands + band].input_energy *= energy_ratio;
            }
        }
    }

    fn smooth_formants(&mut self, estimate: f32) {
        let slew = 1.0 / (estimate * 0.5 + 1.0);
        let mut level = 0.0;
        let formants = &mut self.formants[..self.bands];
        for _ in 0..2 {
            for value in formants.iter_mut().rev() {
                level += (*value - level) * slew;
                *value = level;
            }
            for value in formants.iter_mut() {
                level += (*value - level) * slew;
                *value = level;
            }
        }
    }

    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "the band is clamped to the formant range first"
    )]
    fn formant_at(&self, band: f32) -> f32 {
        if band < 0.0 {
            return 0.0;
        }
        let clamped = band.min(to_float(self.bands));
        let floor = clamped.floor();
        let index = floor as usize;
        let low = self.formants[index];
        let high = self.formants[index + 1];
        low + (high - low) * (clamped - floor)
    }

    fn estimate_frequency(&mut self) -> f32 {
        let metric = &self.formants;
        let mut peaks = [0_usize; 3];
        for band in 1..self.bands - 1 {
            if metric[band] >= metric[band - 1] && metric[band] > metric[band + 1] {
                peaks = rank_peak(peaks, metric, band);
            }
        }
        let mut estimate = to_signed(peaks[2]);
        if metric[peaks[1]] > metric[peaks[2]] * 0.1 {
            estimate = fold_estimate(estimate, peaks[1]);
            if metric[peaks[0]] > metric[peaks[2]] * 0.01 {
                estimate = fold_estimate(estimate, peaks[0]);
            }
        }
        let weight = metric[peaks[2]];
        self.estimate_weighted +=
            (to_float(to_unsigned(estimate)) * weight - self.estimate_weighted) * 0.25;
        self.estimate_weight += (weight - self.estimate_weight) * 0.25;
        self.estimate_weighted / (self.estimate_weight + TINY)
    }

    fn predict_channel(&mut self, channel: usize) {
        for band in 0..self.bands {
            let point = self.map[band];
            let index = channel * self.bands + band;
            let previous_energy = self.predictions[index].energy;
            let energy = self.fractional_at(channel, point.input_band, |bin| bin.input_energy)
                * point.gradient.max(0.0);
            let input = self.fractional_at(channel, point.input_band, |bin| bin.input);
            let previous = self.fractional_at(channel, point.input_band, |bin| bin.previous);
            self.predictions[index] = Prediction { energy, input };
            let phase = self.bins[index].output * (input * previous.conj());
            self.bins[index].output = phase / (previous_energy.max(energy) + NOISE_FLOOR);
        }
    }

    fn predict_band(&mut self, band: usize, steps: &Steps) {
        let strongest = self.strongest_channel(band);
        let base = strongest * self.bands;
        let prediction = self.predictions[base + band];
        let mut phase = Complex32::default();
        if band > 0 {
            phase += self.phase_from_below(strongest, band, steps);
        }
        if band < self.bands - 1 {
            phase += self.phase_from_above(strongest, band, steps);
        }
        let output = prediction.make_output(phase);
        self.bins[base + band].output = output;
        for channel in (0..self.channels).filter(|channel| *channel != strongest) {
            let index = channel * self.bands + band;
            let other = self.predictions[index];
            self.bins[index].output =
                other.make_output(output * (other.input * prediction.input.conj()));
        }
    }

    fn phase_from_below(&mut self, channel: usize, band: usize, steps: &Steps) -> Complex32 {
        let base = channel * self.bands;
        let input = self.predictions[base + band].input;
        let position = self.map[band].input_band;
        let factor = self.draw_time_factor(steps);
        let down = self.fractional_at(channel, position - factor, |bin| bin.input);
        let mut phase = self.bins[base + band - 1].output * (input * down.conj());
        if band >= steps.long_step {
            let long_down = self.fractional_at(
                channel,
                position - to_float(steps.long_step) * factor,
                |bin| bin.input,
            );
            phase += self.bins[base + band - steps.long_step].output * (input * long_down.conj());
        }
        phase
    }

    fn phase_from_above(&mut self, channel: usize, band: usize, steps: &Steps) -> Complex32 {
        let base = channel * self.bands;
        let factor = self.draw_time_factor(steps);
        let up = self.predictions[base + band + 1].input;
        let down = self.fractional_at(channel, self.map[band + 1].input_band - factor, |bin| {
            bin.input
        });
        let mut phase = self.bins[base + band + 1].output * (up * down.conj()).conj();
        if band + steps.long_step < self.bands {
            let far = band + steps.long_step;
            let long_up = self.predictions[base + far].input;
            let long_down = self.fractional_at(
                channel,
                self.map[far].input_band - to_float(steps.long_step) * factor,
                |bin| bin.input,
            );
            phase += self.bins[base + far].output * (long_up * long_down.conj()).conj();
        }
        phase
    }

    fn draw_time_factor(&mut self, steps: &Steps) -> f32 {
        steps.random_low.map_or(steps.time_factor, |low| {
            self.random.between(low, steps.time_factor)
        })
    }

    fn strongest_channel(&self, band: usize) -> usize {
        let mut strongest = 0;
        let mut level = self.predictions[band].energy;
        for channel in 1..self.channels {
            let energy = self.predictions[channel * self.bands + band].energy;
            if energy > level {
                strongest = channel;
                level = energy;
            }
        }
        strongest
    }

    fn band_value<T: Default>(&self, channel: usize, index: i64, read: impl Fn(&Band) -> T) -> T {
        usize::try_from(index)
            .ok()
            .filter(|band| *band < self.bands)
            .map_or_else(T::default, |band| {
                read(&self.bins[channel * self.bands + band])
            })
    }

    fn fractional_at<T>(&self, channel: usize, position: f32, read: impl Fn(&Band) -> T) -> T
    where
        T: Default + Copy + Add<Output = T> + Sub<Output = T> + Mul<f32, Output = T>,
    {
        let floor = position.floor();
        let low = to_index(floor);
        let low_value = self.band_value(channel, low, &read);
        let high_value = self.band_value(channel, low + 1, &read);
        low_value + (high_value - low_value) * (position - floor)
    }

    fn flush(&mut self, output: &mut [Vec<f32>], latency: usize) {
        let plain = latency.min(self.stft.block());
        let folded = latency.min(self.stft.block() - plain);
        self.stft.finish_output();
        let mut extra = vec![0.0; folded];
        for (channel, samples) in output.iter_mut().enumerate() {
            let tail_start = samples.len() - latency;
            let tail = &mut samples[tail_start..];
            self.stft.read_output(channel, 0, &mut tail[..plain]);
            self.stft.read_output(channel, plain, &mut extra);
            for (index, value) in extra.iter().enumerate() {
                tail[latency - 1 - index] -= value;
            }
        }
    }
}

fn rank_peak(peaks: [usize; 3], metric: &[f32], band: usize) -> [usize; 3] {
    let level = metric[band];
    if level <= metric[peaks[0]] {
        return peaks;
    }
    if level <= metric[peaks[1]] {
        return [band, peaks[1], peaks[2]];
    }
    if level <= metric[peaks[2]] {
        return [peaks[1], band, peaks[2]];
    }
    [peaks[1], peaks[2], band]
}

fn fold_estimate(estimate: i64, peak: usize) -> i64 {
    let difference = (estimate - to_signed(peak)).abs();
    if difference > estimate / 8 && difference < estimate * 7 / 8 {
        return estimate % difference;
    }
    estimate
}

fn fold_start(samples: &mut [f32], latency: usize) {
    let length = samples.len();
    for index in 0..(length - latency).min(latency) {
        samples[index + latency] -= samples[latency - 1 - index];
    }
    samples.copy_within(latency.., 0);
}
