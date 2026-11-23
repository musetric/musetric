#[cfg(test)]
mod tests {
    use musetric_dsp::{
        BoxedError,
        render::{
            CHANNELS, Parts, Piece, Song, StemLayout, StemPages, TakeKey, Takes, Target, lay_out,
            render_song,
        },
    };
    use sha2::{Digest, Sha256};
    use std::fmt::Write;
    #[cfg(target_arch = "wasm32")]
    use wasm_bindgen_test::wasm_bindgen_test as test;

    const RATE: u32 = 48_000;
    const PAGE: usize = 4_096;

    fn noise(frames: usize, seed: u32) -> Vec<f32> {
        let mut state = seed;
        (0..frames)
            .map(|_| {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                f32::from(u16::try_from(state >> 16).unwrap()) / 65_536.0 - 0.5
            })
            .collect()
    }

    fn piece(song_start: f64, frames: usize, tempo: f64) -> Piece {
        Piece {
            song_start,
            tempo,
            transpose: 0,
            octave: 0,
            samples: vec![0.0; frames],
        }
    }

    fn spans(pieces: &[Piece]) -> Vec<(f64, f64, usize)> {
        lay_out(&pieces.iter().collect::<Vec<_>>())
            .iter()
            .map(|segment| (segment.start, segment.end, segment.piece))
            .collect()
    }

    fn keyed(transpose: i32, octave: i32) -> Piece {
        Piece {
            transpose,
            octave,
            ..piece(0.0, 1, 1.0)
        }
    }

    fn shifted(transpose: i32, voice_octave: Option<i32>) -> Target {
        Target {
            transpose,
            voice_octave: voice_octave.unwrap_or(0),
            voice_shifted: voice_octave.is_some(),
            ..Target::ORIGINAL
        }
    }

    #[test]
    fn shifts_a_take_by_the_octave_of_the_voice_only_when_it_is_shifted() {
        assert_eq!(shifted(2, None).shift(&keyed(-1, 1)).1, 3);
        assert_eq!(shifted(2, Some(0)).shift(&keyed(-1, 1)).1, -9);
        assert_eq!(shifted(-2, Some(1)).shift(&keyed(0, 0)).1, 10);
    }

    #[test]
    fn lets_a_later_piece_cover_the_middle_of_an_earlier_one() {
        assert_eq!(
            spans(&[piece(0.0, 100, 1.0), piece(40.0, 40, 0.5)]),
            [(0.0, 40.0, 0), (40.0, 60.0, 1), (60.0, 100.0, 0)]
        );
    }

    #[test]
    fn keeps_pieces_apart_when_they_do_not_touch() {
        assert_eq!(
            spans(&[piece(50.0, 10, 2.0), piece(0.0, 10, 1.0)]),
            [(0.0, 10.0, 1), (50.0, 70.0, 0)]
        );
    }

    fn live(chunks: &[(f64, f64)], tempo: f64) -> Vec<(f64, f64, usize)> {
        let mut takes = Takes::new(RATE);
        takes.begin_live(
            1,
            TakeKey {
                tempo,
                transpose: 0,
                octave: 0,
            },
        );
        for (start, offset) in chunks {
            takes.append_live(*start, *offset, &[0.5; 4]);
        }
        takes
            .segments()
            .iter()
            .map(|segment| (segment.start, segment.end, segment.piece))
            .collect()
    }

    #[test]
    fn continues_a_live_run_only_with_a_later_chunk_from_the_same_start() {
        assert_eq!(live(&[(10.0, 0.0), (10.0, 4.0)], 1.0), [(10.0, 18.0, 0)]);
        assert_eq!(
            live(&[(10.0, 0.0), (12.0, 4.0)], 1.0),
            [(10.0, 14.0, 0), (16.0, 20.0, 1)]
        );
        assert_eq!(live(&[(10.0, 0.0), (10.0, 0.0)], 1.0), [(10.0, 14.0, 1)]);
    }

    #[test]
    fn places_a_run_joined_late_where_its_first_chunk_was_sung() {
        assert_eq!(live(&[(10.0, 8.0)], 0.5), [(14.0, 16.0, 0)]);
    }

    fn stem_channels(stem: usize, frames: usize) -> Vec<Vec<f32>> {
        (0..CHANNELS)
            .map(|channel| noise(frames, u32::try_from(stem * 2 + channel + 1).unwrap()))
            .collect()
    }

    struct Stems {
        channels: Vec<Vec<Vec<f32>>>,
    }

    impl Stems {
        fn new(frames: usize) -> Self {
            Self {
                channels: (0..3).map(|stem| stem_channels(stem, frames)).collect(),
            }
        }

        fn silent(frames: usize) -> Self {
            Self {
                channels: vec![vec![vec![0.0; frames]; CHANNELS]; 3],
            }
        }
    }

    impl StemPages for Stems {
        fn layout(&self, stem: usize) -> StemLayout {
            let frames = self.channels[stem][0].len();
            StemLayout {
                frame_count: i64::try_from(frames).unwrap(),
                page_starts: (0..frames)
                    .step_by(PAGE)
                    .map(|start| i64::try_from(start).unwrap())
                    .collect(),
            }
        }

        fn read(&mut self, stem: usize, index: usize) -> Result<Vec<f32>, BoxedError> {
            let channels = &self.channels[stem];
            let start = index * PAGE;
            let end = (start + PAGE).min(channels[0].len());
            Ok(channels
                .iter()
                .flat_map(|channel| channel[start..end].iter().copied())
                .collect())
        }
    }

    fn render(stems: &mut Stems, song: &Song, parts: Parts) -> Vec<f32> {
        render_song(stems, song, parts, &mut |_| true)
            .unwrap()
            .unwrap()
    }

    #[test]
    fn plays_a_take_at_its_own_tempo_exactly_as_it_was_sung() {
        for tempo in [0.5, 0.8, 1.1] {
            let raw = noise(usize::try_from(RATE).unwrap(), 9);
            let song = Song {
                sample_rate: RATE,
                frame_count: 120_000,
                volumes: [1.0; 3],
                target: Target {
                    tempo,
                    ..Target::ORIGINAL
                },
                recording_volume: 1.0,
                pieces: vec![Piece {
                    song_start: 0.0,
                    tempo,
                    transpose: 0,
                    octave: 0,
                    samples: raw.clone(),
                }],
            };
            let played = render(&mut Stems::silent(96_000), &song, Parts::ALL);
            let left: Vec<f32> = played.iter().step_by(CHANNELS).copied().collect();
            assert_eq!(&left[..raw.len()], raw.as_slice(), "{tempo}");
        }
    }

    fn scene(target: Target) -> Song {
        let mut transposed = piece(30_000.0, 40_000, 0.8);
        transposed.samples = noise(40_000, 11);
        transposed.transpose = 2;
        transposed.octave = -1;
        let mut covering = piece(50_000.0, 20_000, 1.0);
        covering.samples = noise(20_000, 12);
        Song {
            sample_rate: RATE,
            frame_count: 150_000,
            volumes: [0.8, 0.5, 1.25],
            target,
            recording_volume: 0.7,
            pieces: vec![transposed, covering],
        }
    }

    fn voiced(tempo: f64, transpose: i32) -> [Target; 2] {
        [(0, false), (1, true)].map(|(voice_octave, voice_shifted)| Target {
            tempo,
            transpose,
            voice_octave,
            voice_shifted,
        })
    }

    fn targets() -> Vec<Target> {
        [1.0, 0.8, 1.25]
            .into_iter()
            .flat_map(|tempo| {
                [0, -2]
                    .into_iter()
                    .flat_map(move |transpose| voiced(tempo, transpose))
            })
            .collect()
    }

    fn add(exported: &mut [f32], part: &[f32]) {
        if part.len() == exported.len() {
            for (sample, value) in exported.iter_mut().zip(part) {
                *sample += value;
            }
            return;
        }
        for (frame, value) in exported.as_chunks_mut::<CHANNELS>().0.iter_mut().zip(part) {
            for sample in frame {
                *sample += value;
            }
        }
    }

    fn export(stems: &mut Stems, song: &Song) -> Vec<f32> {
        let mut exported = render(stems, song, Parts::SONG);
        if !song.pieces.is_empty() {
            add(&mut exported, &render(stems, song, Parts::TAKES));
        }
        if song.target.voice_shifted && song.target.voice_octave != 0 {
            add(&mut exported, &render(stems, song, Parts::LEAD));
        }
        exported
    }

    #[test]
    fn exports_by_its_parts_what_the_player_renders_quantum_by_quantum() {
        let mut stems = Stems::new(120_000);
        for target in targets() {
            let song = scene(target);
            let played = render(&mut stems, &song, Parts::ALL);
            let exported = export(&mut stems, &song);
            let equal = played
                .iter()
                .zip(&exported)
                .all(|(left, right)| left.to_bits() == right.to_bits());
            assert!(equal, "{target:?}");
            assert!(played.iter().any(|sample| *sample != 0.0), "{target:?}");
        }
    }

    fn digest(samples: &[f32]) -> String {
        let bytes: Vec<u8> = samples
            .iter()
            .flat_map(|sample| sample.to_le_bytes())
            .collect();
        Sha256::digest(&bytes)
            .iter()
            .fold(String::new(), |mut hex, byte| {
                write!(hex, "{byte:02x}").unwrap();
                hex
            })
    }

    #[test]
    fn renders_the_same_samples_on_every_target() {
        let mut stems = Stems::new(120_000);
        let digests: Vec<String> = [
            Target {
                tempo: 0.8,
                transpose: -2,
                voice_octave: 1,
                voice_shifted: true,
            },
            Target {
                tempo: 1.25,
                transpose: 0,
                voice_octave: 0,
                voice_shifted: false,
            },
            Target {
                tempo: 1.0,
                transpose: 3,
                voice_octave: -1,
                voice_shifted: true,
            },
        ]
        .into_iter()
        .map(|target| digest(&render(&mut stems, &scene(target), Parts::ALL)))
        .collect();
        assert_eq!(
            digests,
            [
                "81dc3a27127791efa176431ec21a399097c07963876c88886de6bc689a746788",
                "09b5da0f2b7f29366380247f59bf029a4fb3a96fb0b41e560355845b1bf0955f",
                "c333742c4a2a82fe4563b16c97932a2439ce434a31aa274a52b972f803f6002a"
            ]
        );
    }
}
