#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use musetric_dsp::{
        decode::{DecodeRequest, Decoder, Layout},
        flac::{FlacWriter, read_layout},
        flac_feed::FlacFeed,
    };
    #[cfg(target_arch = "wasm32")]
    use wasm_bindgen_test::wasm_bindgen_test as test;

    const RATE: u32 = 48_000;
    const FRAMES: usize = 240_000;
    const BLOCK_FRAMES: usize = 4096;
    const LAST_SPAN_SAMPLE: usize = 192_000;
    const CHUNK_BYTES: usize = 1000;
    const INFO_BYTES: usize = 42;
    const LAST_BLOCK: u8 = 0x80;

    fn noise(state: &mut u32) -> f32 {
        *state = state.wrapping_mul(1_103_515_245).wrapping_add(12_345);
        f32::from(u16::try_from(*state >> 16).expect("the noise is 16 bits")) / 32_768.0 - 1.0
    }

    fn master() -> Vec<u8> {
        let mut writer = FlacWriter::create(Cursor::new(Vec::new()), RATE)
            .expect("the writer should be created");
        let mut state = 3;
        for frame in 0..FRAMES {
            let swell = f32::from(u16::try_from(frame % 9600).expect("the swell fits")) / 9600.0;
            writer.push(noise(&mut state) * swell, noise(&mut state) / 4.0);
        }
        writer
            .finish()
            .expect("the master should be written")
            .into_inner()
    }

    fn without_seek_table(bytes: &[u8]) -> Vec<u8> {
        let layout = read_layout(bytes)
            .expect("the header should be read")
            .expect("the header should be whole");
        let mut stripped = bytes[..INFO_BYTES].to_vec();
        stripped[4] |= LAST_BLOCK;
        let start = usize::try_from(layout.frames_start).expect("the header fits");
        stripped.extend_from_slice(&bytes[start..]);
        stripped
    }

    fn decode_whole(bytes: &[u8], sample_rate: Option<u32>) -> Vec<f32> {
        let request = DecodeRequest {
            source: Box::new(Cursor::new(bytes.to_vec())),
            extension: Some("flac"),
            sample_rate,
            layout: Layout::Source,
        };
        let mut decoder = Decoder::open(request).expect("the master should open");
        let mut samples = Vec::new();
        while let Some(frames) = decoder.read().expect("the master should decode") {
            samples.extend_from_slice(frames);
        }
        samples
    }

    fn feed(bytes: &[u8], sample_rate: Option<u32>, chunk_bytes: usize) -> Vec<f32> {
        let mut feed = FlacFeed::create(sample_rate);
        let mut samples = Vec::new();
        for chunk in bytes.chunks(chunk_bytes) {
            samples.extend_from_slice(feed.push(chunk).expect("the span should decode"));
        }
        samples.extend_from_slice(feed.finish().expect("the last span should decode"));
        samples
    }

    fn bits(samples: &[f32]) -> Vec<u32> {
        samples.iter().map(|sample| sample.to_bits()).collect()
    }

    #[test]
    fn decodes_every_span_as_the_whole_master_decodes() {
        let bytes = master();

        let whole = decode_whole(&bytes, None);

        assert_eq!(whole.len(), FRAMES * 2);
        assert_eq!(bits(&feed(&bytes, None, CHUNK_BYTES)), bits(&whole));
        assert_eq!(bits(&feed(&bytes, None, bytes.len())), bits(&whole));
    }

    #[test]
    fn resamples_the_spans_as_the_whole_master_resamples() {
        let bytes = master();

        let whole = decode_whole(&bytes, Some(44_100));

        assert_eq!(whole.len(), 220_500 * 2);
        assert_eq!(bits(&feed(&bytes, Some(44_100), CHUNK_BYTES)), bits(&whole));
    }

    #[test]
    fn decodes_the_spans_before_the_master_ends() {
        let bytes = master();
        let mut feed = FlacFeed::create(None);

        let early = feed.push(&bytes).expect("the spans should decode").len();
        let late = feed.finish().expect("the last span should decode").len();

        let last_span = LAST_SPAN_SAMPLE / BLOCK_FRAMES * BLOCK_FRAMES;
        assert_eq!(early, last_span * 2);
        assert_eq!(late, (FRAMES - last_span) * 2);
    }

    #[test]
    fn decodes_a_master_without_a_seek_table_at_its_end() {
        let bytes = master();
        let stripped = without_seek_table(&bytes);
        let mut feed = FlacFeed::create(None);

        let early = feed
            .push(&stripped)
            .expect("the header should be read")
            .len();
        let late = feed.finish().expect("the master should decode").to_vec();

        assert_eq!(early, 0);
        assert_eq!(bits(&late), bits(&decode_whole(&bytes, None)));
    }

    #[test]
    fn counts_the_frames_once_the_header_has_arrived() {
        let bytes = master();
        let mut feed = FlacFeed::create(Some(44_100));

        feed.push(&bytes[..INFO_BYTES])
            .expect("the stream info should be read");
        let before = (feed.channels(), feed.frame_count());
        feed.push(&bytes[INFO_BYTES..])
            .expect("the header should be read");

        assert_eq!(before, (None, None));
        assert_eq!(feed.channels(), Some(2));
        assert_eq!(feed.frame_count(), Some(220_500));
    }

    #[test]
    fn refuses_a_stream_that_is_not_flac() {
        let mut feed = FlacFeed::create(None);

        let refused = feed.push(&[0; INFO_BYTES]);

        assert!(refused.is_err(), "zeros should not read as flac");
    }
}
