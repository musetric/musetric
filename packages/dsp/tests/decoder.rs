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

    #[test]
    fn counts_the_frames_of_a_take_before_it_decodes() {
        for (sample_rate, frames) in [(None, usize::from(FRAMES)), (Some(44_100), 11_025)] {
            let request = DecodeRequest {
                source: Box::new(Cursor::new(mono_wav(&samples()))),
                extension: Some("wav"),
                sample_rate,
                layout: Layout::Stereo,
            };
            let decoder = Decoder::open(request).expect("the take should open");

            assert_eq!(decoder.frame_count(), Some(frames));
        }
    }

    #[cfg(feature = "opus")]
    const OPUS_PRE_SKIP: u16 = 312;
    #[cfg(feature = "opus")]
    const OPUS_PACKETS: u32 = 50;
    #[cfg(feature = "opus")]
    const OPUS_PACKET_FRAMES: u32 = 960;
    #[cfg(feature = "opus")]
    const OPUS_END_PADDING: u32 = 500;
    #[cfg(feature = "opus")]
    const CELT_FULLBAND_20_MS_STEREO: u8 = 0xFC;
    #[cfg(feature = "opus")]
    const OGG_CRC_POLYNOMIAL: u32 = 0x04C1_1DB7;
    #[cfg(feature = "opus")]
    const OGG_FIRST_PAGE: u8 = 2;
    #[cfg(feature = "opus")]
    const OGG_LAST_PAGE: u8 = 4;

    #[cfg(feature = "opus")]
    const fn ogg_crc_bit(value: u32) -> u32 {
        if value & 0x8000_0000 == 0 {
            value << 1
        } else {
            (value << 1) ^ OGG_CRC_POLYNOMIAL
        }
    }

    #[cfg(feature = "opus")]
    fn ogg_crc(bytes: &[u8]) -> u32 {
        bytes.iter().fold(0, |crc, byte| {
            (0..8).fold(crc ^ (u32::from(*byte) << 24), |value, _| {
                ogg_crc_bit(value)
            })
        })
    }

    #[cfg(feature = "opus")]
    fn ogg_page(kind: u8, granule: u64, sequence: u32, packets: &[Vec<u8>]) -> Vec<u8> {
        let mut page = b"OggS\0".to_vec();
        page.push(kind);
        page.extend_from_slice(&granule.to_le_bytes());
        page.extend_from_slice(&1_u32.to_le_bytes());
        page.extend_from_slice(&sequence.to_le_bytes());
        page.extend_from_slice(&[0; 4]);
        page.push(u8::try_from(packets.len()).expect("a page holds few packets"));
        for packet in packets {
            page.push(u8::try_from(packet.len()).expect("a packet fits one segment"));
        }
        for packet in packets {
            page.extend_from_slice(packet);
        }
        let crc = ogg_crc(&page);
        page[22..26].copy_from_slice(&crc.to_le_bytes());
        page
    }

    #[cfg(feature = "opus")]
    fn ogg_opus(granule: u32) -> Vec<u8> {
        let mut head = b"OpusHead\x01\x02".to_vec();
        head.extend_from_slice(&OPUS_PRE_SKIP.to_le_bytes());
        head.extend_from_slice(&RATE.to_le_bytes());
        head.extend_from_slice(&[0; 3]);
        let mut tags = b"OpusTags".to_vec();
        tags.extend_from_slice(&[0; 8]);
        let audio: Vec<Vec<u8>> = (0..OPUS_PACKETS)
            .map(|_| vec![CELT_FULLBAND_20_MS_STEREO])
            .collect();
        [
            ogg_page(OGG_FIRST_PAGE, 0, 0, &[head]),
            ogg_page(0, 0, 1, &[tags]),
            ogg_page(OGG_LAST_PAGE, u64::from(granule), 2, &audio),
        ]
        .concat()
    }

    #[cfg(feature = "opus")]
    fn decode_ogg_opus(granule: u32) -> (u32, Option<usize>, Vec<f32>) {
        let request = DecodeRequest {
            source: Box::new(Cursor::new(ogg_opus(granule))),
            extension: Some("opus"),
            sample_rate: None,
            layout: Layout::Stereo,
        };
        let mut decoder = Decoder::open(request).expect("the stream should open");
        let counted = decoder.frame_count();
        let mut samples = Vec::new();
        while let Some(frames) = decoder.read().expect("the stream should decode") {
            samples.extend_from_slice(frames);
        }
        (decoder.sample_rate(), counted, samples)
    }

    #[cfg(feature = "opus")]
    #[test]
    fn decodes_ogg_opus_on_every_target() {
        let granule = OPUS_PACKETS * OPUS_PACKET_FRAMES;
        let (rate, counted, first) = decode_ogg_opus(granule);
        let (_, _, second) = decode_ogg_opus(granule);
        let frames = granule - u32::from(OPUS_PRE_SKIP);
        assert_eq!(rate, RATE);
        assert_eq!(
            counted,
            Some(usize::try_from(frames).expect("the frames fit"))
        );
        assert_eq!(
            first.len(),
            usize::try_from(frames * 2).expect("the frames fit")
        );
        assert!(first.iter().all(|sample| sample.abs() <= 1.0));
        assert_eq!(first, second);
    }

    #[cfg(feature = "opus")]
    #[test]
    fn trims_the_end_padding_of_ogg_opus() {
        let granule = OPUS_PACKETS * OPUS_PACKET_FRAMES - OPUS_END_PADDING;
        let (_, counted, samples) = decode_ogg_opus(granule);
        let frames = usize::try_from(granule - u32::from(OPUS_PRE_SKIP)).expect("the frames fit");
        assert_eq!(counted, Some(frames));
        assert_eq!(samples.len(), frames * 2);
    }
}
