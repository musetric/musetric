use std::{
    fs::{create_dir_all, remove_dir_all, write},
    path::PathBuf,
    process::id,
    sync::atomic::{AtomicUsize, Ordering},
};

use crate::decode::SymphoniaPcm;

static TAKEN: AtomicUsize = AtomicUsize::new(0);

pub(crate) struct Partial {
    pub(crate) frequency: f32,
    pub(crate) amplitude: f32,
    pub(crate) phase: f32,
}

pub(crate) struct Signal<'signal> {
    pub(crate) name: &'signal str,
    pub(crate) seconds: f64,
    pub(crate) sample_rate: u32,
    pub(crate) left: &'signal [Partial],
    pub(crate) right: &'signal [Partial],
    pub(crate) gate: Option<&'signal (dyn Fn(f32) -> f32 + Sync)>,
}

pub(crate) struct Fixture {
    directory: PathBuf,
    pub(crate) pcm: SymphoniaPcm,
}

impl Fixture {
    pub(crate) fn create() -> Self {
        let taken = TAKEN.fetch_add(1, Ordering::Relaxed);
        let directory = std::env::temp_dir().join(format!("musetric-media-{}-{taken}", id()));
        create_dir_all(&directory).expect("the fixture directory should be built");
        Self {
            directory,
            pcm: SymphoniaPcm,
        }
    }

    pub(crate) fn join(&self, name: &str) -> PathBuf {
        self.directory.join(name)
    }

    pub(crate) fn asset(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("fixtures")
            .join(name)
    }

    pub(crate) fn write_wav(&self, signal: &Signal<'_>) -> PathBuf {
        let to = self.join(signal.name);
        let samples = render(signal);
        let bytes = wav_bytes(&samples, 2, 2);
        write(&to, bytes).expect("the fixture should be written");
        to
    }

    pub(crate) fn write_wav24(&self, signal: &Signal<'_>) -> PathBuf {
        let to = self.join(signal.name);
        let samples = render(signal);
        let bytes = wav_bytes(&samples, 3, 2);
        write(&to, bytes).expect("the fixture should be written");
        to
    }

    pub(crate) fn write_raw(&self, signal: &Signal<'_>) -> PathBuf {
        let to = self.join(signal.name);
        let samples = render(signal);
        let mut bytes = Vec::with_capacity(samples.len() * 4);
        for value in samples {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        write(&to, bytes).expect("the fixture should be written");
        to
    }
}

#[expect(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "the fixture length and time base stay far below the exact range of the target types"
)]
pub(crate) fn render(signal: &Signal<'_>) -> Vec<f32> {
    let count = (signal.seconds * f64::from(signal.sample_rate)) as usize;
    let mut samples = Vec::with_capacity(count * 2);
    for index in 0..count {
        let time = index as f32 / signal.sample_rate as f32;
        let gate = signal.gate.map_or(1.0, |gate| gate(time));
        samples.push(mix(signal.left, time) * gate);
        samples.push(mix(signal.right, time) * gate);
    }
    samples
}

pub(crate) fn read_floats(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(size_of::<f32>())
        .filter_map(|value| <[u8; 4]>::try_from(value).ok())
        .map(f32::from_le_bytes)
        .collect()
}

pub(crate) fn correlation(left: &[f32], right: &[f32]) -> f64 {
    let mut product = 0.0_f64;
    let mut left_energy = 0.0_f64;
    let mut right_energy = 0.0_f64;
    for (first, second) in left.iter().zip(right) {
        product += f64::from(*first) * f64::from(*second);
        left_energy += f64::from(*first) * f64::from(*first);
        right_energy += f64::from(*second) * f64::from(*second);
    }
    product / (left_energy.sqrt() * right_energy.sqrt())
}

pub(crate) fn level(measured: &[f32], expected: &[f32]) -> f64 {
    let mut measured_energy = 0.0_f64;
    let mut expected_energy = 0.0_f64;
    for (first, second) in measured.iter().zip(expected) {
        measured_energy += f64::from(*first) * f64::from(*first);
        expected_energy += f64::from(*second) * f64::from(*second);
    }
    (measured_energy / expected_energy).sqrt()
}

pub(crate) fn worst_difference(measured: &[f32], expected: &[f32]) -> f32 {
    measured
        .iter()
        .zip(expected)
        .map(|(ours, theirs)| (ours - theirs).abs())
        .fold(0.0_f32, f32::max)
}

fn mix(partials: &[Partial], time: f32) -> f32 {
    partials
        .iter()
        .map(|partial| {
            partial.amplitude
                * (2.0 * std::f32::consts::PI * partial.frequency * time + partial.phase).sin()
        })
        .sum()
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "the sample is rounded and clamped into the target width before the cast"
)]
fn wav_bytes(samples: &[f32], bytes_per_sample: usize, channels: usize) -> Vec<u8> {
    let data_length = samples.len() * bytes_per_sample;
    let mut bytes = Vec::with_capacity(data_length + 44);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&u32::try_from(data_length + 36).unwrap_or(0).to_le_bytes());
    bytes.extend_from_slice(b"WAVE");
    bytes.extend_from_slice(b"fmt ");
    bytes.extend_from_slice(&16_u32.to_le_bytes());
    bytes.extend_from_slice(&1_u16.to_le_bytes());
    bytes.extend_from_slice(&u16::try_from(channels).unwrap_or(0).to_le_bytes());
    let rate = 48_000_u32;
    bytes.extend_from_slice(&rate.to_le_bytes());
    let block = u32::try_from(rate as usize * channels * bytes_per_sample).unwrap_or(0);
    bytes.extend_from_slice(&block.to_le_bytes());
    bytes.extend_from_slice(
        &u16::try_from(channels * bytes_per_sample)
            .unwrap_or(0)
            .to_le_bytes(),
    );
    bytes.extend_from_slice(
        &u16::try_from(bytes_per_sample * 8)
            .unwrap_or(0)
            .to_le_bytes(),
    );
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&u32::try_from(data_length).unwrap_or(0).to_le_bytes());
    for value in samples {
        let scaled = (value * 8_388_608.0)
            .round()
            .clamp(-8_388_608.0, 8_388_607.0);
        if bytes_per_sample == 2 {
            let quantized = (scaled / 256.0) as i16;
            bytes.extend_from_slice(&quantized.to_le_bytes());
        } else {
            let quantized = scaled as i32;
            let lead = quantized.to_le_bytes();
            bytes.extend_from_slice(&lead[..3]);
        }
    }
    bytes
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = remove_dir_all(&self.directory);
    }
}
