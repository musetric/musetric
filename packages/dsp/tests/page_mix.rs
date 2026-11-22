#[cfg(test)]
mod tests {
    use musetric_dsp::page_mix::{LoopRange, MixRequest, PageMixer, PageShape};
    #[cfg(target_arch = "wasm32")]
    use wasm_bindgen_test::wasm_bindgen_test as test;

    const FRAMES: usize = 120_000;
    const STARTS: [i64; 5] = [0, 30_011, 72_000, 96_000, 110_000];
    const VOLUMES: [f32; 3] = [0.8, 0.5, 1.25];
    const ALL: u32 = 0b111;

    fn stem(seed: u32, channels: usize) -> Vec<Vec<f32>> {
        let mut state = seed;
        (0..channels)
            .map(|_| {
                (0..FRAMES)
                    .map(|_| {
                        state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                        f32::from(u16::try_from(state >> 16).expect("fits")) / 65_536.0 - 0.5
                    })
                    .collect()
            })
            .collect()
    }

    fn stems() -> Vec<Vec<Vec<f32>>> {
        vec![stem(1, 2), stem(2, 2), stem(3, 1)]
    }

    fn page_end(starts: &[i64], index: usize) -> usize {
        starts
            .get(index + 1)
            .map_or(FRAMES, |end| usize::try_from(*end).expect("fits"))
    }

    fn load(mixer: &mut PageMixer, stems: &[Vec<Vec<f32>>], starts: &[i64], skip: &[usize]) {
        let frames = i64::try_from(FRAMES).expect("fits");
        for (index, channels) in stems.iter().enumerate() {
            mixer
                .set_stem(index, frames, starts)
                .expect("the stem should be set");
            for page in (0..starts.len()).filter(|page| !skip.contains(page)) {
                let from = usize::try_from(starts[page]).expect("fits");
                let to = page_end(starts, page);
                let shape = PageShape {
                    stem: index,
                    index: page,
                    frames: to - from,
                    channels: channels.len(),
                };
                let input = mixer.page_input(shape).expect("a slot should be free");
                fill_page(input, channels, from, to);
            }
        }
    }

    fn fill_page(input: &mut [f32], channels: &[Vec<f32>], from: usize, to: usize) {
        for (channel, samples) in channels.iter().enumerate() {
            input[channel * (to - from)..(channel + 1) * (to - from)]
                .copy_from_slice(&samples[from..to]);
        }
    }

    fn add_looped(sums: &mut [f32], channels: &[Vec<f32>], volume: f32, frames: (i64, &LoopRange)) {
        let (first, range) = frames;
        let count = sums.len() / 2;
        for offset in 0..count {
            let song_frame = range.song_frame(first + i64::try_from(offset).expect("fits"));
            let at = usize::try_from(song_frame).expect("fits");
            let gain = range.gain(song_frame);
            for (channel, sum) in sums.iter_mut().skip(offset).step_by(count).enumerate() {
                *sum += channels[channel.min(channels.len() - 1)][at] * volume * gain;
            }
        }
    }

    fn mixed(mixer: &mut PageMixer, first: i64, count: usize) -> Vec<u32> {
        let request = MixRequest {
            first,
            count,
            mask: ALL,
        };
        mixer
            .mix(request, &VOLUMES)
            .iter()
            .map(|sample| sample.to_bits())
            .collect()
    }

    #[test]
    fn mixes_pages_to_the_bits_of_whole_stems() {
        let stems = stems();
        let mut whole = PageMixer::new(2, 3);
        load(&mut whole, &stems, &[0], &[]);
        let mut pages = PageMixer::new(2, 3);
        load(&mut pages, &stems, &STARTS, &[]);

        for (first, count) in [
            (-100, 5_000),
            (29_000, 3_000),
            (71_990, 30_000),
            (119_900, 400),
        ] {
            assert_eq!(
                mixed(&mut pages, first, count),
                mixed(&mut whole, first, count)
            );
        }
    }

    #[test]
    fn mixes_pages_from_slots_reserved_before_them_to_the_same_bits() {
        let stems = stems();
        let frames = i64::try_from(FRAMES).expect("fits");
        let mut reserved = PageMixer::new(2, 3);
        for index in 0..stems.len() {
            reserved
                .set_stem(index, frames, &STARTS)
                .expect("the stem should be set");
        }
        reserved.reserve_pages(stems.len() * STARTS.len());
        load(&mut reserved, &stems, &STARTS, &[]);
        let mut pages = PageMixer::new(2, 3);
        load(&mut pages, &stems, &STARTS, &[]);

        for (first, count) in [(-100, 5_000), (71_990, 30_000)] {
            assert_eq!(
                mixed(&mut reserved, first, count),
                mixed(&mut pages, first, count)
            );
        }
    }

    #[test]
    fn mixes_a_loop_with_its_fades_as_each_sample_asks() {
        let stems = stems();
        let range = LoopRange {
            from: 60_000,
            to: 100_000,
            end: 100_000,
            cycle: true,
        };
        let mut mixer = PageMixer::new(2, 3);
        load(&mut mixer, &stems, &STARTS, &[]);
        mixer.set_range(Some(range));

        let (first, count) = (99_000, 4_000);
        let actual = mixed(&mut mixer, first, count);

        let mut sums = vec![0.0_f32; count * 2];
        for (index, channels) in stems.iter().enumerate() {
            add_looped(&mut sums, channels, VOLUMES[index], (first, &range));
        }
        let expected: Vec<u32> = sums.iter().map(|sample| sample.to_bits()).collect();
        assert_eq!(actual, expected);
    }

    #[test]
    fn waits_for_a_missing_page_and_plays_silence_in_its_place() {
        let stems = stems();
        let mut mixer = PageMixer::new(2, 3);
        load(&mut mixer, &stems, &STARTS, &[2]);

        assert!(mixer.ready(40_000));
        assert!(!mixer.ready(70_000));
        let request = MixRequest {
            first: 72_000,
            count: 100,
            mask: ALL,
        };
        assert!(
            mixer
                .mix(request, &VOLUMES)
                .iter()
                .all(|sample| *sample == 0.0)
        );

        load(&mut mixer, &stems, &STARTS, &[]);
        assert!(mixer.ready(70_000));
    }

    #[test]
    fn mixes_only_the_stems_of_its_mask() {
        let stems = stems();
        let mut mixer = PageMixer::new(2, 3);
        load(&mut mixer, &stems, &STARTS, &[]);
        let request = MixRequest {
            first: 1_000,
            count: 10,
            mask: 0b100,
        };

        let mono = mixer.mix(request, &VOLUMES).to_vec();

        for offset in 0..10 {
            let expected = stems[2][0][1_000 + offset] * VOLUMES[2];
            assert_eq!(mono[offset].to_bits(), expected.to_bits());
            assert_eq!(mono[10 + offset].to_bits(), expected.to_bits());
        }
    }
}
