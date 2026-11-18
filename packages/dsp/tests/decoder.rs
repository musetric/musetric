#[cfg(test)]
mod tests {
    use std::{f32::consts::FRAC_1_SQRT_2, io::Cursor};

    use musetric_dsp::{
        decode::{DecodeRequest, Decoder, Layout},
        resample::{Conversion, SampleRates},
    };
    #[cfg(target_arch = "wasm32")]
    use wasm_bindgen_test::wasm_bindgen_test as test;

    const RATE: u32 = 48_000;
    const FRAMES: u16 = 12_000;
    const SCALE: f32 = 32_768.0;

    fn samples() -> Vec<i16> {
        let mut state = 7_u32;
        (0..FRAMES)
            .map(|_| {
                state = state.wrapping_mul(1_103_515_245).wrapping_add(12_345);
                i16::from_le_bytes(
                    (state >> 8).to_le_bytes()[..2]
                        .try_into()
                        .expect("two bytes"),
                )
            })
            .collect()
    }

    fn mono_wav(samples: &[i16]) -> Vec<u8> {
        let data = u32::try_from(samples.len() * 2).expect("the data fits");
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16_u32.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&RATE.to_le_bytes());
        bytes.extend_from_slice(&(RATE * 2).to_le_bytes());
        bytes.extend_from_slice(&2_u16.to_le_bytes());
        bytes.extend_from_slice(&16_u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data.to_le_bytes());
        for sample in samples {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        bytes
    }

    fn read_all(layout: Layout, sample_rate: Option<u32>) -> (usize, u32, Vec<f32>) {
        let request = DecodeRequest {
            source: Box::new(Cursor::new(mono_wav(&samples()))),
            extension: Some("wav"),
            sample_rate,
            layout,
        };
        let mut decoder = Decoder::open(request).expect("the take should open");
        let mut samples = Vec::new();
        while let Some(frames) = decoder.read().expect("the take should decode") {
            samples.extend_from_slice(frames);
        }
        (decoder.channels(), decoder.sample_rate(), samples)
    }

    #[test]
    fn keeps_a_mono_take_mono_and_exact() {
        let (channels, rate, decoded) = read_all(Layout::Source, None);

        let expected: Vec<f32> = samples()
            .iter()
            .map(|sample| f32::from(*sample) / SCALE)
            .collect();
        assert_eq!(channels, 1);
        assert_eq!(rate, RATE);
        assert_eq!(decoded, expected);
    }

    #[test]
    fn folds_a_mono_take_into_stereo_for_the_host() {
        let (channels, _, decoded) = read_all(Layout::Stereo, None);

        let expected: Vec<f32> = samples()
            .iter()
            .flat_map(|sample| {
                let value = f32::from(*sample) / SCALE * FRAC_1_SQRT_2;
                [value, value]
            })
            .collect();
        assert_eq!(channels, 2);
        assert_eq!(decoded, expected);
    }

    #[test]
    fn resamples_one_channel_as_it_resamples_each_of_two() {
        let mono: Vec<f32> = samples()
            .iter()
            .map(|sample| f32::from(*sample) / SCALE)
            .collect();
        let stereo: Vec<f32> = mono.iter().flat_map(|value| [*value, *value]).collect();
        let rates = SampleRates {
            input: 44_100,
            output: RATE,
        };
        let resample = |samples: &[f32], channels: usize| {
            let mut conversion =
                Conversion::create(rates, channels).expect("the resampler should be created");
            let mut out = Vec::new();
            for chunk in samples.chunks(4096 * channels) {
                out.extend_from_slice(conversion.convert(chunk).expect("the chunk converts"));
            }
            out.extend_from_slice(
                conversion
                    .flush(samples.len() / channels)
                    .expect("the tail converts"),
            );
            out
        };

        let left: Vec<f32> = resample(&stereo, 2).into_iter().step_by(2).collect();
        assert_eq!(resample(&mono, 1), left);
    }

    #[test]
    fn resamples_a_mono_take_while_it_decodes() {
        let (channels, rate, decoded) = read_all(Layout::Source, Some(44_100));

        assert_eq!(channels, 1);
        assert_eq!(rate, 44_100);
        assert_eq!(decoded.len(), 11_025);
    }
}
