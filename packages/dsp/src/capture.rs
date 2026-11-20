use std::f64::consts::PI;

const CAPACITY: usize = 1 << 17;
const TAPS: usize = 64;
const PHASES: usize = 512;
const BETA: f64 = 9.0;

pub struct CaptureRing {
    samples: Vec<f32>,
    end: Option<i64>,
    cutoff: f64,
    table: Vec<f64>,
}

impl Default for CaptureRing {
    fn default() -> Self {
        Self::new()
    }
}

impl CaptureRing {
    #[must_use]
    pub fn new() -> Self {
        Self {
            samples: vec![0.0; CAPACITY],
            end: None,
            cutoff: 1.0,
            table: kernel_table(1.0),
        }
    }

    pub fn set_step(&mut self, step: f64) {
        let cutoff = if step > 1.0 { 1.0 / step } else { 1.0 };
        if (cutoff - self.cutoff).abs() > f64::EPSILON {
            self.cutoff = cutoff;
            self.table = kernel_table(cutoff);
        }
    }

    pub fn clear(&mut self) {
        self.samples.fill(0.0);
        self.end = None;
    }

    pub fn write(&mut self, frame: i64, samples: &[f32]) {
        let length = to_signed(samples.len());
        let previous_end = self.end.unwrap_or(frame);
        let next_end = previous_end.max(frame + length);
        let oldest = next_end - to_signed(CAPACITY);
        for gap in previous_end.max(oldest)..frame {
            self.samples[slot(gap)] = 0.0;
        }
        let first = (oldest - frame).max(0);
        for (target, sample) in (frame + first..).zip(&samples[to_index(first)..]) {
            self.samples[slot(target)] = *sample;
        }
        self.end = Some(next_end);
    }

    pub fn render(&self, output: &mut [f32], at: f64, ratio: f64) -> f64 {
        let mut position = at;
        for sample in output {
            *sample = self.sample_at(position);
            position += ratio;
        }
        position
    }

    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "a position is a frame of a recording and its phase is below the phase count"
    )]
    fn sample_at(&self, at: f64) -> f32 {
        let index = at.floor();
        let fraction = at - index;
        let base = index as i64;
        if fraction == 0.0 {
            return self.read(base);
        }
        let place = fraction * to_float(PHASES);
        let phase = (place.floor() as usize).min(PHASES - 1);
        let blend = place - to_float(phase);
        let before = &self.table[phase * TAPS..][..TAPS];
        let after = &self.table[(phase + 1) * TAPS..][..TAPS];
        let first = base - to_signed(TAPS / 2 - 1);
        let mut sum = 0.0;
        if let Some(window) = self.window(first) {
            for ((sample, low), high) in window.iter().zip(before).zip(after) {
                sum += f64::from(*sample) * (low + (high - low) * blend);
            }
        } else {
            for ((frame, low), high) in (first..).zip(before).zip(after) {
                sum += f64::from(self.read(frame)) * (low + (high - low) * blend);
            }
        }
        sum as f32
    }

    fn window(&self, first: i64) -> Option<&[f32]> {
        let end = self.end?;
        let start = slot(first);
        let inside = first >= end - to_signed(CAPACITY) && first + to_signed(TAPS) <= end;
        (inside && start + TAPS <= CAPACITY).then(|| &self.samples[start..start + TAPS])
    }

    fn read(&self, frame: i64) -> f32 {
        match self.end {
            Some(end) if frame < end && frame >= end - to_signed(CAPACITY) => {
                self.samples[slot(frame)]
            }
            _ => 0.0,
        }
    }
}

fn slot(frame: i64) -> usize {
    to_index(frame.rem_euclid(to_signed(CAPACITY)))
}

fn to_signed(value: usize) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

fn to_index(value: i64) -> usize {
    usize::try_from(value).unwrap_or(0)
}

#[expect(
    clippy::cast_precision_loss,
    reason = "taps and phases are small counts"
)]
const fn to_float(value: usize) -> f64 {
    value as f64
}

fn bessel_i0(value: f64) -> f64 {
    let quarter = value * value / 4.0;
    let mut term = 1.0;
    let mut sum = 1.0;
    let mut order = 1.0;
    while term > sum * 1e-17 {
        term *= quarter / (order * order);
        sum += term;
        order += 1.0;
    }
    sum
}

fn kernel_table(cutoff: f64) -> Vec<f64> {
    let half = to_float(TAPS / 2);
    let scale = bessel_i0(BETA);
    let mut table = Vec::with_capacity((PHASES + 1) * TAPS);
    for phase in 0..=PHASES {
        let fraction = to_float(phase) / to_float(PHASES);
        let row: Vec<f64> = (0..TAPS)
            .map(|tap| {
                let distance = fraction + half - 1.0 - to_float(tap);
                let shape = 1.0 - (distance / half).powi(2);
                if shape <= 0.0 {
                    return 0.0;
                }
                let window = bessel_i0(BETA * shape.sqrt()) / scale;
                let x = PI * cutoff * distance;
                let sinc = if x == 0.0 { 1.0 } else { x.sin() / x };
                cutoff * sinc * window
            })
            .collect();
        let total: f64 = row.iter().sum();
        table.extend(row.iter().map(|value| value / total));
    }
    table
}

#[cfg(test)]
mod tests {
    use std::f64::consts::TAU;
    #[cfg(target_arch = "wasm32")]
    use wasm_bindgen_test::wasm_bindgen_test as test;

    use super::CaptureRing;

    const RATE: f64 = 48_000.0;

    #[expect(
        clippy::cast_possible_truncation,
        reason = "test signals are stored as f32"
    )]
    fn tone(frequency: f64, length: usize) -> Vec<f32> {
        (0..length)
            .map(|index| {
                (0.5 * (TAU * frequency * f64::from(u32::try_from(index).unwrap()) / RATE).sin())
                    as f32
            })
            .collect()
    }

    fn filled(samples: &[f32]) -> CaptureRing {
        let mut ring = CaptureRing::new();
        ring.write(0, samples);
        ring
    }

    #[test]
    fn copies_the_samples_at_whole_frames() {
        let samples = tone(1234.0, 4096);
        let ring = filled(&samples);
        let mut output = vec![0.0; 1024];
        let next = ring.render(&mut output, 1000.0, 1.0);
        assert_eq!(output, samples[1000..2024]);
        assert!((next - 2024.0).abs() < f64::EPSILON);
    }

    #[test]
    fn reads_a_tone_between_frames() {
        for frequency in [440.0, 5000.0, 12_000.0, 19_000.0] {
            let samples = tone(frequency, 8192);
            let ring = filled(&samples);
            let mut output = vec![0.0; 2048];
            let start = 3000.37;
            let ratio = 1.000_04;
            ring.render(&mut output, start, ratio);
            let mut error = 0.0_f64;
            let mut position = start;
            for value in &output {
                let exact = 0.5 * (TAU * frequency * position / RATE).sin();
                error = error.max((f64::from(*value) - exact).abs());
                position += ratio;
            }
            assert!(error < 1e-4, "{frequency}: {error}");
        }
    }

    #[test]
    fn keeps_a_ramp_on_its_frames() {
        let samples: Vec<f32> = (0..60_000_u16).map(f32::from).collect();
        let ring = filled(&samples);
        let mut output = vec![0.0; 512];
        ring.render(&mut output, 30_000.25, 1.088);
        let mut position = 30_000.25;
        for value in &output {
            assert!(
                (f64::from(*value) - position).abs() < 0.01,
                "{position}: {value}"
            );
            position += 1.088;
        }
    }

    #[test]
    fn reads_silence_outside_what_was_written() {
        let ring = filled(&tone(440.0, 1000));
        let mut output = vec![1.0; 16];
        ring.render(&mut output, 1100.5, 1.0);
        assert!(output.iter().all(|value| *value == 0.0));
        let empty = CaptureRing::new();
        empty.render(&mut output, 10.5, 1.0);
        assert!(output.iter().all(|value| *value == 0.0));
    }

    fn peak_through(step: f64) -> f32 {
        let mut ring = filled(&tone(23_500.0, 8192));
        ring.set_step(step);
        let mut output = vec![0.0; 2048];
        ring.render(&mut output, 3000.5, step);
        output.iter().fold(0.0, |peak, value| peak.max(value.abs()))
    }

    #[test]
    fn filters_what_a_lower_rate_cannot_hold() {
        let kept = peak_through(1.0);
        let filtered = peak_through(48_000.0 / 44_100.0);
        assert!(filtered * 10.0 < kept, "{kept} {filtered}");
    }
}
