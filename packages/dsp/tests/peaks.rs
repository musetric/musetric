#[cfg(test)]
mod tests {
    use musetric_dsp::peaks::WavePeaks;
    #[cfg(target_arch = "wasm32")]
    use wasm_bindgen_test::wasm_bindgen_test as test;

    const FRAMES: u16 = 20_000;

    fn stereo() -> Vec<f32> {
        let mut state = 11_u32;
        (0..FRAMES * 2)
            .map(|_| {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                f32::from(u16::try_from(state >> 16).expect("the high half fits")) / 32_768.0 - 1.0
            })
            .collect()
    }

    #[test]
    fn traces_the_same_peaks_from_parts_as_from_the_whole() {
        let samples = stereo();
        let mut whole = WavePeaks::create(u64::from(FRAMES));
        whole.push(&samples);
        let mut parts = WavePeaks::create(u64::from(FRAMES));
        for part in samples.chunks(1_234 * 2) {
            parts.push(part);
        }

        assert_eq!(parts.peaks(), whole.peaks());
        assert_eq!(parts.finish(), whole.finish());
    }
}
