mod fourier;
mod frames;
#[cfg(test)]
mod test_signal;
mod vocoder;
mod window;

use vocoder::{Engine, Settings};
pub use vocoder::{Planar, PlanarMut};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Refusal {
    TooShort,
    Stopped,
}

pub struct Stretch {
    pub sample_rate: u32,
    pub frame_count: usize,
    pub semitones: i32,
    pub keep_formants: bool,
}

impl Stretch {
    pub fn apply(
        &self,
        channels: &[Vec<f32>],
        go_on: &mut dyn FnMut(usize) -> bool,
    ) -> Result<Vec<Vec<f32>>, Refusal> {
        let mut engine = Engine::new(&Settings {
            channels: channels.len(),
            sample_rate: self.sample_rate,
            semitones: self.semitones,
            keep_formants: self.keep_formants,
        });
        engine.exact(channels, self.frame_count, go_on)
    }
}

pub struct StretchStream {
    engine: Engine,
}

impl StretchStream {
    #[must_use]
    pub fn new(channels: usize, sample_rate: u32) -> Self {
        Self {
            engine: Engine::new(&Settings {
                channels,
                sample_rate,
                semitones: 0,
                keep_formants: false,
            }),
        }
    }

    #[must_use]
    pub const fn input_latency(&self) -> usize {
        self.engine.input_latency()
    }

    #[must_use]
    pub const fn output_latency(&self) -> usize {
        self.engine.output_latency()
    }

    #[must_use]
    pub const fn seek_length(&self) -> usize {
        self.engine.seek_length()
    }

    #[must_use]
    pub const fn overlap_length(&self) -> usize {
        self.engine.overlap_length()
    }

    pub fn reset(&mut self) {
        self.engine.reset();
    }

    pub fn set_semitones(&mut self, semitones: i32) {
        self.engine.set_semitones(semitones);
    }

    pub const fn set_keep_formants(&mut self, keep_formants: bool) {
        self.engine.set_keep_formants(keep_formants);
    }

    pub fn seek(&mut self, window: &Planar<'_>, rate: f64) {
        self.engine.seek_window(window, rate);
    }

    pub fn process(&mut self, input: &Planar<'_>, output: &mut PlanarMut<'_>) {
        self.engine.process_stream(input, output);
    }
}

#[cfg(test)]
mod tests {
    use std::f64::consts::TAU;
    #[cfg(target_arch = "wasm32")]
    use wasm_bindgen_test::wasm_bindgen_test as test;

    use super::{Planar, PlanarMut, Refusal, Stretch, StretchStream};

    const SAMPLE_RATE: u32 = 44_100;

    fn frames(milliseconds: u32) -> usize {
        usize::try_from(SAMPLE_RATE / 10 * milliseconds / 100).unwrap()
    }

    fn scaled(frame: usize, numerator: usize, denominator: usize) -> usize {
        let wide = |value: usize| u64::try_from(value).unwrap();
        usize::try_from(wide(frame) * wide(numerator) / wide(denominator)).unwrap()
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
        .apply(input, &mut |_| true)
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
                let expected = scaled(*beat, output_length, length);
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
        .apply(&input, &mut |_| true);
        assert_eq!(refused, Err(Refusal::TooShort));
    }

    #[test]
    fn reports_the_frames_it_wrote_and_stops_when_told() {
        let input = vec![sine(440.0, frames(2000))];
        let stretch = Stretch {
            sample_rate: SAMPLE_RATE,
            frame_count: frames(3000),
            semitones: 2,
            keep_formants: false,
        };
        let mut written = Vec::new();
        let output = stretch.apply(&input, &mut |frames| {
            written.push(frames);
            true
        });
        assert!(output.is_ok());
        assert_eq!(written.first(), Some(&0));
        assert_eq!(written.last(), Some(&frames(3000)));
        assert!(written.is_sorted());
        let mut blocks = 0;
        let stopped = stretch.apply(&input, &mut |_| {
            blocks += 1;
            blocks < 3
        });
        assert_eq!(stopped, Err(Refusal::Stopped));
        assert_eq!(blocks, 3);
    }

    const QUANTUM: usize = 128;

    fn window_before(input: &[f32], end: usize, length: usize) -> Vec<f32> {
        (0..length)
            .map(|index| {
                (end + index)
                    .checked_sub(length)
                    .and_then(|frame| input.get(frame))
                    .copied()
                    .unwrap_or(0.0)
            })
            .collect()
    }

    fn planar(samples: &[f32]) -> Planar<'_> {
        Planar {
            samples,
            stride: samples.len(),
            frames: samples.len(),
        }
    }

    fn seek_every_quantum(input: &[f32], semitones: i32, quanta: usize) -> Vec<f32> {
        let mut stream = StretchStream::new(1, SAMPLE_RATE);
        stream.set_semitones(semitones);
        let length = stream.input_latency() + stream.output_latency();
        let mut output = vec![0.0; quanta * QUANTUM];
        for (quantum, block) in output.as_chunks_mut::<QUANTUM>().0.iter_mut().enumerate() {
            let window = window_before(input, quantum * QUANTUM + length, length);
            stream.seek(&planar(&window), 1.0);
            stream.process(
                &planar(&[]),
                &mut PlanarMut {
                    samples: block,
                    stride: QUANTUM,
                    frames: QUANTUM,
                },
            );
        }
        output
    }

    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        clippy::cast_precision_loss,
        reason = "a quantum's input is a few hundred frames"
    )]
    fn stream_at_tempo(
        stream: &mut StretchStream,
        input: &[f32],
        tempo: f64,
        quanta: usize,
    ) -> Vec<f32> {
        let primed = stream.input_latency();
        let window = window_before(input, primed, stream.seek_length());
        stream.seek(&planar(&window), tempo);
        let mut consumed = primed;
        let mut fraction = 0.0;
        let mut output = vec![0.0; quanta * QUANTUM];
        for block in output.as_chunks_mut::<QUANTUM>().0 {
            let wanted = QUANTUM as f64 * tempo + fraction;
            let taken = wanted.floor() as usize;
            fraction = wanted - taken as f64;
            let piece = window_before(input, consumed + taken, taken);
            consumed += taken;
            stream.process(
                &planar(&piece),
                &mut PlanarMut {
                    samples: block,
                    stride: QUANTUM,
                    frames: QUANTUM,
                },
            );
        }
        output
    }

    #[test]
    fn moves_the_semitones_while_it_seeks_every_quantum() {
        let input = sine(440.0, frames(2500));
        let output = seek_every_quantum(&input, 2, frames(2000) / QUANTUM);
        let expected = 440.0 * 2.0_f64.powf(2.0 / 12.0);
        let measured = frequency(&output[frames(500)..frames(1500)]);
        assert!((measured / expected - 1.0).abs() < 0.004, "{measured}");
    }

    #[test]
    fn keeps_the_pitch_while_it_streams_at_another_tempo() {
        let input = sine(440.0, frames(2500));
        let mut stream = StretchStream::new(1, SAMPLE_RATE);
        let output = stream_at_tempo(&mut stream, &input, 0.8, frames(2000) / QUANTUM);
        let measured = frequency(&output[frames(500)..frames(1500)]);
        assert!((measured / 440.0 - 1.0).abs() < 0.004, "{measured}");
    }

    #[test]
    fn starts_over_after_a_reset() {
        let input = sine(440.0, frames(1000));
        let mut stream = StretchStream::new(1, SAMPLE_RATE);
        stream.set_semitones(3);
        let first = stream_at_tempo(&mut stream, &input, 0.75, frames(800) / QUANTUM);
        stream.reset();
        let again = stream_at_tempo(&mut stream, &input, 0.75, frames(800) / QUANTUM);
        assert_eq!(first, again);
    }
}
