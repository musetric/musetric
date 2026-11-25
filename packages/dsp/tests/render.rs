#[cfg(test)]
mod tests {
    use musetric_dsp::{
        BoxedError,
        page_mix::{LoopRange, PageShape},
        render::{
            CHANNELS, Parts, Piece, QUANTUM, Quantum, Renderer, STEM_COUNT, Song, StemLayout,
            Target, TrackPages, lay_out, render_song,
        },
    };
    #[cfg(target_arch = "wasm32")]
    use wasm_bindgen_test::wasm_bindgen_test as test;

    const RATE: u32 = 48_000;
    const PAGE: usize = 4_096;
    const TAKE_PAGE: usize = 9_600;

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
            track: STEM_COUNT,
            frame_count: frames,
        }
    }

    fn spans(pieces: &[Piece]) -> Vec<(f64, f64, usize)> {
        lay_out(&pieces.iter().collect::<Vec<_>>())
            .iter()
            .map(|segment| (segment.start, segment.end, segment.piece))
            .collect()
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

    fn stem_channels(stem: usize, frames: usize) -> Vec<Vec<f32>> {
        (0..CHANNELS)
            .map(|channel| noise(frames, u32::try_from(stem * 2 + channel + 1).unwrap()))
            .collect()
    }

    fn pages_of(frames: usize, page: usize) -> Vec<i64> {
        (0..frames)
            .step_by(page)
            .map(|start| i64::try_from(start).unwrap())
            .collect()
    }

    struct Tracks {
        stems: Vec<Vec<Vec<f32>>>,
        takes: Vec<Vec<f32>>,
        stem_page: usize,
        take_page: usize,
    }

    impl Tracks {
        fn new(frames: usize, takes: Vec<Vec<f32>>) -> Self {
            Self {
                stems: (0..STEM_COUNT)
                    .map(|stem| stem_channels(stem, frames))
                    .collect(),
                takes,
                stem_page: PAGE,
                take_page: TAKE_PAGE,
            }
        }

        fn silent(frames: usize, takes: Vec<Vec<f32>>) -> Self {
            Self {
                stems: vec![vec![vec![0.0; frames]; CHANNELS]; STEM_COUNT],
                takes,
                stem_page: PAGE,
                take_page: TAKE_PAGE,
            }
        }

        fn take_page(&self, track: usize) -> usize {
            self.take_page
                .min(self.takes[track - STEM_COUNT].len().max(1))
        }
    }

    impl TrackPages for Tracks {
        fn layout(&self, track: usize) -> StemLayout {
            if track >= STEM_COUNT {
                let frames = self.takes[track - STEM_COUNT].len();
                return StemLayout {
                    frame_count: i64::try_from(frames).unwrap(),
                    page_starts: pages_of(frames, self.take_page(track)),
                };
            }
            let frames = self.stems[track][0].len();
            StemLayout {
                frame_count: i64::try_from(frames).unwrap(),
                page_starts: pages_of(frames, self.stem_page),
            }
        }

        fn read(&mut self, track: usize, index: usize) -> Result<Vec<f32>, BoxedError> {
            if track >= STEM_COUNT {
                let samples = &self.takes[track - STEM_COUNT];
                let page = self.take_page(track);
                let start = index * page;
                return Ok(samples[start..(start + page).min(samples.len())].to_vec());
            }
            let channels = &self.stems[track];
            let start = index * self.stem_page;
            let end = (start + self.stem_page).min(channels[0].len());
            Ok(channels
                .iter()
                .flat_map(|channel| channel[start..end].iter().copied())
                .collect())
        }
    }

    fn render(tracks: &mut Tracks, song: &Song, parts: Parts) -> Vec<f32> {
        render_song(tracks, song, parts, &mut |_| true)
            .unwrap()
            .unwrap()
    }

    fn sung(song_start: f64, samples: &[f32], tempo: f64, track: usize) -> Piece {
        Piece {
            song_start,
            tempo,
            transpose: 0,
            octave: 0,
            track: STEM_COUNT + track,
            frame_count: samples.len(),
        }
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
                pieces: vec![sung(0.0, &raw, tempo, 0)],
            };
            let mut tracks = Tracks::silent(96_000, vec![raw.clone()]);
            let played = render(&mut tracks, &song, Parts::ALL);
            let left: Vec<f32> = played.iter().step_by(CHANNELS).copied().collect();
            assert_eq!(&left[..raw.len()], raw.as_slice(), "{tempo}");
        }
    }

    fn clicks(seconds: usize) -> Vec<f32> {
        let rate = usize::try_from(RATE).unwrap();
        let mut samples = vec![0.0; rate * seconds];
        for second in 0..seconds {
            for index in 0..64_u8 {
                samples[second * rate + usize::from(index)] = 0.8 * (1.0 - f32::from(index) / 64.0);
            }
        }
        samples
    }

    fn click_peak(left: &[f32], center: usize) -> f32 {
        left[center - 2_400..center + 2_400]
            .iter()
            .fold(0.0, |peak: f32, value| peak.max(value.abs()))
    }

    #[test]
    fn keeps_the_first_moments_of_a_stretched_take() {
        let (long, short) = (clicks(4), clicks(2));
        let song = Song {
            sample_rate: RATE,
            frame_count: 300_000,
            volumes: [0.0; 3],
            target: Target {
                tempo: 0.8,
                transpose: -2,
                ..Target::ORIGINAL
            },
            recording_volume: 0.5,
            pieces: vec![
                sung(48_000.0, &long, 1.0, 0),
                sung(168_000.0, &short, 1.0, 1),
            ],
        };
        let mut tracks = Tracks::silent(240_000, vec![long, short]);
        let played = render(&mut tracks, &song, Parts::ALL);
        let left: Vec<f32> = played.iter().step_by(CHANNELS).copied().collect();
        let peaks: Vec<f32> = [60_000, 120_000, 180_000, 210_000, 270_000]
            .into_iter()
            .map(|center| click_peak(&left, center))
            .collect();
        let quietest = [peaks[1], peaks[2], peaks[4]]
            .into_iter()
            .fold(f32::MAX, f32::min);
        assert!(peaks[0] > quietest / 2.0, "{peaks:?}");
        assert!(peaks[3] > quietest / 2.0, "{peaks:?}");
    }

    fn scene_takes() -> Vec<Vec<f32>> {
        vec![noise(40_000, 11), noise(20_000, 12)]
    }

    fn scene(target: Target) -> Song {
        let takes = scene_takes();
        let mut transposed = sung(30_000.0, &takes[0], 0.8, 0);
        transposed.transpose = 2;
        transposed.octave = -1;
        Song {
            sample_rate: RATE,
            frame_count: 150_000,
            volumes: [0.8, 0.5, 1.25],
            target,
            recording_volume: 0.7,
            pieces: vec![transposed, sung(50_000.0, &takes[1], 1.0, 1)],
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

    fn export(tracks: &mut Tracks, song: &Song) -> Vec<f32> {
        let mut exported = render(tracks, song, Parts::SONG);
        if !song.pieces.is_empty() {
            add(&mut exported, &render(tracks, song, Parts::TAKES));
        }
        if song.target.voice_shifted && song.target.voice_octave != 0 {
            add(&mut exported, &render(tracks, song, Parts::LEAD));
        }
        exported
    }

    #[test]
    fn exports_by_its_parts_what_the_player_renders_quantum_by_quantum() {
        let mut tracks = Tracks::new(120_000, scene_takes());
        for target in targets() {
            let song = scene(target);
            let played = render(&mut tracks, &song, Parts::ALL);
            let exported = export(&mut tracks, &song);
            let equal = played
                .iter()
                .zip(&exported)
                .all(|(left, right)| left.to_bits() == right.to_bits());
            assert!(equal, "{target:?}");
            assert!(played.iter().any(|sample| *sample != 0.0), "{target:?}");
        }
    }

    const SONG_FRAMES: usize = 240_000;
    const STEM_PAGE: usize = 30_000;
    const WINDOW_FRAMES: f64 = 96_000.0;

    struct Player {
        renderer: Renderer,
        tracks: Tracks,
        pieces: Vec<Piece>,
        resident: Vec<Vec<bool>>,
        range: Option<LoopRange>,
        window: f64,
    }

    fn load(renderer: &mut Renderer, tracks: &mut Tracks, track: usize, index: usize) {
        let samples = tracks.read(track, index).unwrap();
        let layout = tracks.layout(track);
        let end = layout
            .page_starts
            .get(index + 1)
            .copied()
            .unwrap_or(layout.frame_count);
        let frames = usize::try_from(end - layout.page_starts[index]).unwrap();
        renderer
            .mixer()
            .page_input(PageShape {
                track,
                index,
                frames,
                channels: samples.len() / frames,
            })
            .unwrap()
            .copy_from_slice(&samples);
    }

    fn sung_takes() -> (Vec<Vec<f32>>, Vec<Piece>) {
        let samples = vec![noise(60_000, 21), noise(30_000, 22), noise(50_000, 23)];
        let pieces = vec![
            sung(20_000.0, &samples[0], 1.0, 0),
            sung(50_000.0, &samples[1], 1.0, 1),
            sung(110_000.0, &samples[2], 0.8, 2),
        ];
        (samples, pieces)
    }

    fn lay_out_track(renderer: &mut Renderer, tracks: &Tracks, track: usize) -> usize {
        let layout = tracks.layout(track);
        renderer
            .mixer()
            .set_track(track, layout.frame_count, &layout.page_starts)
            .unwrap();
        layout.page_starts.len()
    }

    fn load_stem(renderer: &mut Renderer, tracks: &mut Tracks, stem: usize) {
        for index in 0..lay_out_track(renderer, tracks, stem) {
            load(renderer, tracks, stem, index);
        }
    }

    fn wanted_pages(layout: &StemLayout, piece: Piece, song_frame: f64, window: f64) -> Vec<bool> {
        let into = |at: f64| (at - piece.song_start) / piece.tempo;
        let (from, to) = (into(song_frame - window), into(song_frame + window));
        let ends = layout
            .page_starts
            .iter()
            .skip(1)
            .copied()
            .chain([layout.frame_count]);
        layout
            .page_starts
            .iter()
            .zip(ends)
            .map(|(start, end)| song_frame_of(*start) < to && song_frame_of(end) > from)
            .collect()
    }

    fn keep_pages(player: &mut Player, take: usize, wanted: &[bool]) {
        let track = player.pieces[take].track;
        for (index, want) in wanted.iter().copied().enumerate() {
            let held = player.resident[take][index];
            if want && !held {
                load(&mut player.renderer, &mut player.tracks, track, index);
            } else if held && !want {
                player.renderer.mixer().drop_page(track, index).unwrap();
            }
            player.resident[take][index] = want;
        }
    }

    impl Player {
        fn open(take_page: usize) -> Self {
            let (samples, pieces) = sung_takes();
            let mut tracks = Tracks::new(SONG_FRAMES, samples);
            tracks.stem_page = STEM_PAGE;
            tracks.take_page = take_page;
            let mut renderer = Renderer::new(RATE);
            renderer.set_volumes(&[0.8, 0.5, 1.25]);
            renderer.set_recording_volume(0.7);
            for stem in 0..STEM_COUNT {
                load_stem(&mut renderer, &mut tracks, stem);
            }
            let resident = pieces
                .iter()
                .map(|piece| vec![false; lay_out_track(&mut renderer, &tracks, piece.track)])
                .collect();
            renderer.set_takes(pieces.clone()).unwrap();
            Self {
                renderer,
                tracks,
                resident,
                pieces,
                range: None,
                window: if take_page < SONG_FRAMES {
                    WINDOW_FRAMES
                } else {
                    f64::INFINITY
                },
            }
        }

        fn song_frame(&self, frame: i64) -> i64 {
            self.range.map_or(frame, |range| range.song_frame(frame))
        }

        fn feed(&mut self, frame: i64) {
            let song_frame = song_frame_of(self.song_frame(frame));
            for take in 0..self.pieces.len() {
                let piece = self.pieces[take];
                let layout = self.tracks.layout(piece.track);
                let wanted = wanted_pages(&layout, piece, song_frame, self.window);
                keep_pages(self, take, &wanted);
            }
        }

        fn play(&mut self, from: i64, quanta: usize) -> Vec<u32> {
            self.renderer.reset();
            let mut frame = from;
            let mut output = vec![0.0; CHANNELS * QUANTUM];
            let mut bits = Vec::with_capacity(quanta * CHANNELS * QUANTUM);
            for _ in 0..quanta {
                self.feed(frame);
                assert!(self.renderer.ready(frame), "{frame}");
                let quantum = Quantum {
                    frame,
                    take_frame: Some(song_frame_of(self.song_frame(frame))),
                };
                let processed = self.renderer.render(quantum, &mut output);
                bits.extend(output.iter().map(|sample| sample.to_bits()));
                frame += i64::try_from(processed).unwrap();
            }
            bits
        }

        fn set_loop(&mut self, from: i64, to: i64) {
            let range = LoopRange {
                from,
                to,
                end: to,
                cycle: true,
            };
            self.range = Some(range);
            self.renderer.set_range(Some(range));
            self.renderer.refill();
        }
    }

    #[expect(
        clippy::cast_precision_loss,
        reason = "a frame of a song is far below the f64 mantissa"
    )]
    const fn song_frame_of(frame: i64) -> f64 {
        frame as f64
    }

    fn run(player: &mut Player) -> Vec<u32> {
        let mut bits = player.play(10_000, 400);
        bits.extend(player.play(108_000, 200));
        bits.extend(player.play(52_000, 120));
        player.set_loop(40_000, 125_000);
        bits.extend(player.play(100_000, 900));
        bits
    }

    #[test]
    fn plays_paged_takes_to_the_bits_of_one_page_per_piece_through_seeks_and_a_loop() {
        let whole = run(&mut Player::open(SONG_FRAMES));
        let paged = run(&mut Player::open(TAKE_PAGE));
        assert_eq!(whole.len(), paged.len());
        let parted = whole
            .iter()
            .zip(&paged)
            .position(|(left, right)| left != right);
        assert_eq!(parted, None);
        assert!(whole.iter().any(|sample| f32::from_bits(*sample) != 0.0));
    }

    #[test]
    fn holds_for_a_missing_take_page() {
        let mut player = Player::open(TAKE_PAGE);
        player.feed(60_000);
        assert!(player.renderer.ready(60_000));
        let track = player.pieces[1].track;
        player.renderer.mixer().drop_page(track, 1).unwrap();
        assert!(!player.renderer.ready(60_000));
        assert!(player.renderer.ready(200_000));
        let mut silent = vec![1.0; QUANTUM];
        player
            .renderer
            .mixer()
            .read_track(track, 10_000, &mut silent);
        assert!(silent.iter().all(|sample| *sample == 0.0));
        load(&mut player.renderer, &mut player.tracks, track, 1);
        assert!(player.renderer.ready(60_000));
    }
}
