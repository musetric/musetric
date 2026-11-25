#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use musetric_dsp::{
        CHANNELS,
        decode::{DecodeRequest, Layout, decode},
        flac::FlacWriter,
    };
    #[cfg(target_arch = "wasm32")]
    use wasm_bindgen_test::wasm_bindgen_test as test;

    const RATE: u32 = 48_000;
    const FRAMES: u16 = 48_000;
    const SAW_FRAMES: u16 = 480;

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
