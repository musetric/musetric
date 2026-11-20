#[cfg(test)]
mod tests {
    use std::{fmt::Write, io::Cursor};

    use musetric_dsp::{
        CHANNELS,
        aac::AacEncoder,
        decode::{DecodeRequest, Layout, decode},
        flac::FlacWriter,
        m4a::{M4aTrack, write_m4a},
        mp3::Mp3Encoder,
        stretch::Stretch,
        wav::WavWriter,
    };
    use sha2::{Digest, Sha256};
    #[cfg(target_arch = "wasm32")]
    use wasm_bindgen_test::wasm_bindgen_test as test;

    const RATE: u32 = 48_000;
    const FRAMES: u16 = 48_000;
    const SAW_FRAMES: u16 = 480;
    const BITRATE: u32 = 192_000;

    fn signal() -> Vec<f32> {
        let mut state = 1_u32;
        (0..FRAMES)
            .flat_map(|frame| {
                state = state.wrapping_mul(1_103_515_245).wrapping_add(12_345);
                let noise =
                    f32::from(u16::try_from(state >> 16).expect("the noise is 16 bits")) / 65_536.0;
                let saw = f32::from(frame % SAW_FRAMES) / f32::from(SAW_FRAMES) - 0.5;
                [saw * 0.5 + noise * 0.1, saw * 0.4 - noise * 0.1]
            })
            .collect()
    }

    fn digest(bytes: &[u8]) -> String {
        Sha256::digest(bytes)
            .iter()
            .fold(String::new(), |mut hex, byte| {
                write!(hex, "{byte:02x}").expect("a string takes every byte");
                hex
            })
    }

    fn flac() -> Vec<u8> {
        let mut writer = FlacWriter::create(Cursor::new(Vec::new()), RATE)
            .expect("the writer should be created");
        for frame in signal().as_chunks::<CHANNELS>().0 {
            writer.push(frame[0], frame[1]);
        }
        writer
            .finish()
            .expect("the stream should be finished")
            .into_inner()
    }

    #[test]
    fn writes_the_same_flac_on_every_target() {
        assert_eq!(
            digest(&flac()),
            "39314460d33bbafaf786da7c3563e1dd639cb7a03ee7a846f9757ab1ad5511e6"
        );
    }

    #[test]
    fn writes_the_same_wav_on_every_target() {
        let samples = signal();
        let frames = samples.as_chunks::<CHANNELS>().0;
        let mut writer = WavWriter::create(Vec::new(), RATE, frames.len())
            .expect("the writer should be created");
        for frame in frames {
            writer
                .push(frame[0], frame[1])
                .expect("the frame should be written");
        }
        let bytes = writer.finish().expect("the stream should be finished");
        assert_eq!(
            digest(&bytes),
            "0c64ae105f84b1aa32f475177df7b9c110ce47b626b8128019b723f19bcadc39"
        );
    }

    #[test]
    fn writes_the_same_m4a_on_every_target() {
        let samples = signal();
        let channels = u8::try_from(CHANNELS).expect("the channels fit");
        let mut encoder =
            AacEncoder::create(RATE, channels, BITRATE).expect("the encoder should be created");
        encoder.push(&samples).expect("the samples should be taken");
        let packets = encoder.finish().expect("the stream should be finished");
        let track = M4aTrack {
            sample_rate: RATE,
            channels,
            packets: &packets,
            frame_count: u32::from(FRAMES),
        };
        let bytes = write_m4a(Vec::new(), &track).expect("the file should be written");
        assert_eq!(
            digest(&bytes),
            "2dadac6bc1b8d274f481e284655112da4ea6c04e3e65a1c546d090de39e38454"
        );
    }

    #[test]
    fn writes_the_same_mp3_on_every_target() {
        let mut encoder = Mp3Encoder::create(RATE, BITRATE);
        encoder
            .push(&signal())
            .expect("the samples should be taken");
        let bytes = encoder
            .finish(Vec::new())
            .expect("the stream should be finished");
        assert_eq!(
            digest(&bytes),
            "6d7e7ec52712f02c2a338931e4dbc06524b0b5655dec404191e5fa0bc9fc0d34"
        );
    }

    #[test]
    fn stretches_to_the_same_samples_on_every_target() {
        let samples = signal();
        let channels: Vec<Vec<f32>> = (0..CHANNELS)
            .map(|channel| {
                samples
                    .iter()
                    .skip(channel)
                    .step_by(CHANNELS)
                    .copied()
                    .collect()
            })
            .collect();
        let digests: Vec<String> = [
            (RATE, 2, false, 48_000),
            (RATE, -3, true, 60_000),
            (22_050, 5, false, 40_000),
        ]
        .into_iter()
        .map(|(sample_rate, semitones, keep_formants, frame_count)| {
            let stretch = Stretch {
                sample_rate,
                frame_count,
                semitones,
                keep_formants,
            };
            let stretched = stretch
                .apply(&channels, &mut |_| true)
                .expect("the signal is long enough to stretch");
            let bytes: Vec<u8> = stretched
                .iter()
                .flatten()
                .flat_map(|sample| sample.to_le_bytes())
                .collect();
            digest(&bytes)
        })
        .collect();
        assert_eq!(
            digests,
            [
                "ce13b20621b2cf4a28712e2f155cd36371ede7766be6be57f1caf5645c268abc",
                "161131439fca54dd31513b1130d8c6e24522b5064c233fe6cba167fd757506af",
                "214207e9ee4be822ee8d7e6861b8ba127f47a4e2918add7cfeefdea0e1ec49c9"
            ]
        );
    }

    #[test]
    fn decodes_its_own_flac_within_a_dithered_step() {
        let bytes = flac();
        let mut decoded = Vec::new();
        let request = DecodeRequest {
            source: Box::new(Cursor::new(bytes)),
            extension: Some("flac"),
            sample_rate: None,
            layout: Layout::Stereo,
        };
        let rate = decode(request, &mut |chunk| {
            decoded.extend_from_slice(chunk);
            Ok(())
        })
        .expect("the stream should decode");

        let scale = 32_768.0_f32;
        let signal = signal();
        assert_eq!(rate, RATE);
        assert_eq!(decoded.len(), signal.len());
        for (got, value) in decoded.iter().zip(&signal) {
            let step = got * scale;
            assert_eq!(step, step.round());
            assert!((step - value * scale).abs() <= 1.5);
        }
    }
}
