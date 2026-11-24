#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use musetric_dsp::{
        decode::{DecodeRequest, Decoder, Layout},
        flac::{FlacWriter, read_layout},
        flac_feed::FlacFeed,
        flac_pages::FlacPages,
        mono::Downmix,
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

    fn page_bytes(bytes: &[u8], pages: &FlacPages, index: usize) -> Vec<u8> {
        let page = pages.pages()[index];
        let start = usize::try_from(page.byte_start).expect("the page starts within the master");
        let end = page.byte_end.map_or(bytes.len(), |end| {
            usize::try_from(end).expect("the page ends within the master")
        });
        bytes[start..end].to_vec()
    }

    fn interleave(planar: &[f32], channels: usize) -> Vec<f32> {
        let frames = planar.len() / channels;
        (0..frames)
            .flat_map(|frame| (0..channels).map(move |channel| planar[channel * frames + frame]))
            .collect()
    }

    #[test]
    fn cuts_the_master_into_pages_at_its_seek_points() {
        let bytes = master();

        let pages = FlacPages::read(&bytes)
            .expect("the header should be read")
            .expect("the header should be whole");

        let found = pages.pages();
        assert!(found.len() > 1, "the master should have more than one page");
        assert_eq!(found[0].first_frame, 0);
        for pair in found.windows(2) {
            assert_eq!(pair[1].first_frame, pair[0].first_frame + pair[0].frames);
            assert_eq!(pair[0].byte_end, Some(pair[1].byte_start));
            assert_eq!(
                pair[1].first_frame % u64::try_from(BLOCK_FRAMES).expect("fits"),
                0
            );
        }
        let last = found.last().expect("the master should have a page");
        assert_eq!(last.byte_end, None);
        assert_eq!(
            last.first_frame + last.frames,
            u64::try_from(FRAMES).expect("the frames fit")
        );
    }

    #[test]
    fn decodes_each_page_as_the_whole_master_decodes_it() {
        let bytes = master();
        let mut pages = FlacPages::read(&bytes)
            .expect("the header should be read")
            .expect("the header should be whole");
        let whole = decode_whole(&bytes, None);
        let count = pages.pages().len();

        let mut order: Vec<usize> = (0..count).rev().collect();
        order.push(0);
        for index in order {
            let page = pages.pages()[index];
            let span = page_bytes(&bytes, &pages, index);
            pages.decode(index, &span).expect("the page should decode");
            let planar = pages.samples().to_vec();
            let first = usize::try_from(page.first_frame).expect("the page fits") * 2;
            let frames = usize::try_from(page.frames).expect("the page fits");

            assert_eq!(planar.len(), frames * 2);
            assert_eq!(
                bits(&interleave(&planar, 2)),
                bits(&whole[first..first + frames * 2])
            );
        }
    }

    #[test]
    fn gives_the_mean_of_the_channels_of_the_page_it_decoded() {
        let bytes = master();
        let mut pages = FlacPages::read(&bytes)
            .expect("the header should be read")
            .expect("the header should be whole");
        let span = page_bytes(&bytes, &pages, 1);

        pages.decode(1, &span).expect("the page should decode");
        let mean = pages.mean().expect("a stereo page has a mean").to_vec();
        let planar = pages.samples().to_vec();

        let frames = planar.len() / 2;
        let expected: Vec<f32> = (0..frames)
            .map(|frame| Downmix::Mean.apply(planar[frame], planar[frames + frame]))
            .collect();
        assert_eq!(bits(&mean), bits(&expected));
    }

    #[test]
    fn makes_one_page_of_a_master_without_a_seek_table() {
        let stripped = without_seek_table(&master());
        let mut pages = FlacPages::read(&stripped)
            .expect("the header should be read")
            .expect("the header should be whole");

        assert_eq!(pages.pages().len(), 1);
        let span = page_bytes(&stripped, &pages, 0);
        pages.decode(0, &span).expect("the page should decode");
        let planar = pages.samples().to_vec();
        assert_eq!(
            bits(&interleave(&planar, 2)),
            bits(&decode_whole(&stripped, None))
        );
    }

    #[test]
    fn waits_for_the_whole_header_before_it_cuts_pages() {
        let bytes = master();

        let early = FlacPages::read(&bytes[..INFO_BYTES]).expect("the stream info should be read");

        assert!(early.is_none(), "the seek table has not arrived");
    }
}
