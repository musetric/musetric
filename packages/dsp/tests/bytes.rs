#[cfg(test)]
mod tests {
    use std::{fmt::Write, io::Cursor};

    use musetric_dsp::{
        CHANNELS,
        aac::AacEncoder,
        decode::{DecodeRequest, Layout, decode},
        depth::SampleDepth,
        flac::FlacWriter,
        m4a::{M4aTrack, write_m4a},
        mp3::Mp3Encoder,
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

    fn flac(depth: SampleDepth) -> Vec<u8> {
        let mut writer = FlacWriter::create(Cursor::new(Vec::new()), RATE, depth)
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
            digest(&flac(SampleDepth::TwentyFour)),
            "31ccb539b711182b3e449bee5196a01c146c321e50099c064f18f9eddcea1f8d"
        );
    }

    #[test]
    fn writes_the_same_wav_on_every_target() {
        let samples = signal();
        let frames = samples.as_chunks::<CHANNELS>().0;
        let mut writer = WavWriter::create(Vec::new(), RATE, SampleDepth::Sixteen, frames.len())
            .expect("the writer should be created");
        for frame in frames {
            writer
                .push(frame[0], frame[1])
                .expect("the frame should be written");
        }
        let bytes = writer.finish().expect("the stream should be finished");
        assert_eq!(
            digest(&bytes),
            "ed0f1d4be01254bebdad2fc01ae262f34316f25ac54baefa0f3790997efb1341"
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
    fn decodes_its_own_flac_to_the_quantized_samples() {
        let bytes = flac(SampleDepth::TwentyFour);
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

        let scale = 8_388_608.0_f32;
        let expected: Vec<f32> = signal()
            .iter()
            .map(|value| (value * scale).round().clamp(-scale, scale - 1.0) / scale)
            .collect();
        assert_eq!(rate, RATE);
        assert_eq!(decoded, expected);
    }
}
