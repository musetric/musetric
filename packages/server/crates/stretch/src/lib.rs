mod fourier;
mod frames;
#[cfg(test)]
mod test_signal;
mod vocoder;
mod window;

use vocoder::{Engine, Settings};

pub struct Stretch {
    pub sample_rate: u32,
    pub frame_count: usize,
    pub semitones: i32,
    pub keep_formants: bool,
}

impl Stretch {
    #[must_use]
    pub fn apply(&self, channels: &[Vec<f32>]) -> Option<Vec<Vec<f32>>> {
        let mut engine = Engine::new(&Settings {
            channels: channels.len(),
            sample_rate: self.sample_rate,
            semitones: self.semitones,
            keep_formants: self.keep_formants,
        });
        engine.exact(channels, self.frame_count)
    }
}

#[cfg(test)]
mod tests {
    use std::f64::consts::TAU;

    use super::Stretch;

    const SAMPLE_RATE: u32 = 44_100;

    fn frames(milliseconds: u32) -> usize {
        usize::try_from(SAMPLE_RATE / 10 * milliseconds / 100).unwrap()
    }

    fn time(index: usize) -> f64 {
        f64::from(u32::try_from(index).unwrap()) / f64::from(SAMPLE_RATE)
    }

    #[expect(
        clippy::cast_possible_truncation,
        reason = "test signals are stored as f32"
    )]
    fn sine(frequency: f64, length: usize) -> Vec<f32> {
        (0..length)
            .map(|index| ((TAU * frequency * time(index)).sin() * 0.5) as f32)
            .collect()
    }

    fn frequency(samples: &[f32]) -> f64 {
        let crossings: Vec<f64> = samples
            .windows(2)
            .enumerate()
            .filter(|(_, pair)| pair[0] < 0.0 && pair[1] >= 0.0)
            .map(|(index, pair)| {
                time(index) + f64::from(-pair[0] / (pair[1] - pair[0])) / f64::from(SAMPLE_RATE)
            })
            .collect();
        let periods = f64::from(u32::try_from(crossings.len() - 1).unwrap());
        periods / (crossings[crossings.len() - 1] - crossings[0])
    }

    fn stretch(input: &[Vec<f32>], frame_count: usize, semitones: i32) -> Vec<Vec<f32>> {
        Stretch {
            sample_rate: SAMPLE_RATE,
            frame_count,
            semitones,
            keep_formants: false,
        }
        .apply(input)
        .unwrap()
    }

    #[test]
    fn moves_a_sine_by_the_semitones() {
        let input = vec![sine(440.0, frames(2000))];
        for semitones in [-6, -1, 1, 6] {
            let output = stretch(&input, frames(2000), semitones);
            let expected = 440.0 * 2.0_f64.powf(f64::from(semitones) / 12.0);
            let measured = frequency(&output[0][frames(500)..frames(1500)]);
            assert!(
                (measured / expected - 1.0).abs() < 0.004,
                "{semitones}: {measured}"
            );
        }
    }

    #[test]
    fn keeps_the_pitch_while_the_tempo_changes() {
        let input = vec![sine(440.0, frames(2000))];
        for length in [frames(1000), frames(2500), frames(4000)] {
            let output = stretch(&input, length, 0);
            assert_eq!(output[0].len(), length);
            let measured = frequency(&output[0][length / 4..length * 3 / 4]);
            assert!(
                (measured / 440.0 - 1.0).abs() < 0.001,
                "{length}: {measured}"
            );
        }
    }

    #[test]
    fn keeps_clicks_on_their_beats() {
        let length = frames(4000);
        let beats: Vec<usize> = (0..8).map(|beat| frames(250 + beat * 500)).collect();
        let mut input = vec![0.0_f32; length];
        for beat in &beats {
            input[*beat] = 1.0;
        }
        for (output_length, semitones) in [(frames(5000), 0), (frames(3200), 3), (frames(4000), -4)]
        {
            let output = stretch(&[input.clone()], output_length, semitones);
            for beat in &beats[1..beats.len() - 1] {
                let expected = beat * output_length / length;
                let window = &output[0][expected - frames(20)..expected + frames(20)];
                let loudest = window
                    .iter()
                    .enumerate()
                    .max_by(|left, right| left.1.abs().total_cmp(&right.1.abs()))
                    .map(|(index, _)| index)
                    .unwrap();
                assert!(
                    loudest.abs_diff(frames(20)) <= frames(1),
                    "{output_length}: {loudest}"
                );
            }
        }
    }

    #[test]
    fn needs_two_latencies_of_output() {
        let input = vec![sine(440.0, frames(1000))];
        let refused = Stretch {
            sample_rate: SAMPLE_RATE,
            frame_count: frames(100),
            semitones: 0,
            keep_formants: false,
        }
        .apply(&input);
        assert!(refused.is_none());
    }
}
