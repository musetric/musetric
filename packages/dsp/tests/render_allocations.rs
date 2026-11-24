#[cfg(test)]
mod tests {
    use allocation_counter::measure;
    use musetric_dsp::{
        page_mix::{LoopRange, PageShape},
        render::{CHANNELS, Parts, Piece, QUANTUM, Quantum, Renderer, STEM_COUNT, Target},
    };
    #[cfg(target_arch = "wasm32")]
    use wasm_bindgen_test::wasm_bindgen_test as test;

    const RATE: u32 = 48_000;
    const PAGE: usize = 48_000;
    const PAGES: usize = 8;
    const TAKE: usize = 96_000;

    fn noise(samples: usize, seed: u32) -> Vec<f32> {
        let mut state = seed;
        (0..samples)
            .map(|_| {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                f32::from(u16::try_from(state >> 16).unwrap()) / 65_536.0 - 0.5
            })
            .collect()
    }

    fn take(song_start: f64, tempo: f64, transpose: i32, seed: u32) -> Piece {
        Piece {
            song_start,
            tempo,
            transpose,
            octave: 0,
            samples: noise(TAKE, seed),
        }
    }

    fn opened() -> Renderer {
        let mut renderer = Renderer::new(RATE);
        let starts: Vec<i64> = (0..PAGES)
            .map(|page| i64::try_from(page * PAGE).unwrap())
            .collect();
        let frame_count = i64::try_from(PAGES * PAGE).unwrap();
        let mixer = renderer.mixer();
        for stem in 0..STEM_COUNT {
            mixer.set_stem(stem, frame_count, &starts).unwrap();
        }
        mixer.reserve_pages(STEM_COUNT * PAGES);
        for stem in 0..STEM_COUNT {
            for index in 0..PAGES {
                let shape = PageShape {
                    stem,
                    index,
                    frames: PAGE,
                    channels: CHANNELS,
                };
                let seed = u32::try_from(stem * PAGES + index + 1).unwrap();
                mixer
                    .page_input(shape)
                    .unwrap()
                    .copy_from_slice(&noise(CHANNELS * PAGE, seed));
            }
        }
        renderer.takes().set_pieces(
            vec![take(24_000.0, 1.0, 0, 101), take(168_000.0, 0.8, 2, 102)],
            None,
            true,
        );
        renderer
    }

    struct Step {
        target: Target,
        range: Option<LoopRange>,
        parts: Parts,
        frames: (i64, i64),
        input: usize,
    }

    fn steps() -> [Step; 5] {
        let stretched = Target {
            tempo: 0.75,
            transpose: 3,
            ..Target::ORIGINAL
        };
        let song = |target: Target, frames: (i64, i64), input: usize| Step {
            target,
            range: None,
            parts: Parts::ALL,
            frames,
            input,
        };
        [
            song(Target::ORIGINAL, (0, 264_000), QUANTUM),
            song(stretched, (0, 264_000), 96),
            song(
                Target {
                    voice_octave: 1,
                    voice_shifted: true,
                    ..stretched
                },
                (96_000, 264_000),
                96,
            ),
            Step {
                range: Some(LoopRange {
                    from: 96_000,
                    to: 192_000,
                    end: 192_000,
                    cycle: true,
                }),
                ..song(stretched, (96_000, 288_000), 96)
            },
            Step {
                target: Target {
                    tempo: 1.25,
                    transpose: -2,
                    voice_octave: -1,
                    voice_shifted: true,
                },
                parts: Parts::TAKES,
                ..song(stretched, (0, 264_000), 160)
            },
        ]
    }

    fn song_frame(range: Option<LoopRange>, frame: i64) -> f64 {
        let looped = range.map_or(frame, |cycle| cycle.song_frame(frame));
        f64::from(u32::try_from(looped).unwrap())
    }

    struct Run {
        allocating: Vec<(i64, u64)>,
        heard: bool,
    }

    fn run(renderer: &mut Renderer, step: &Step) -> Run {
        let mut block = vec![0.0; CHANNELS * QUANTUM];
        let mut allocating = Vec::new();
        let mut heard = false;
        let (from, to) = step.frames;
        let changed = measure(|| {
            renderer.set_range(step.range);
            renderer.set_tempo(step.target.tempo);
            renderer.set_voice(step.target.voice_octave, step.target.voice_shifted);
            renderer.set_transpose(step.target.transpose);
            renderer.reset();
        });
        if changed.count_total > 0 {
            allocating.push((from, changed.count_total));
        }
        let mut frame = from;
        while frame < to {
            let quantum = Quantum {
                frame,
                take_frame: Some(song_frame(step.range, frame)),
            };
            let mut processed = 0;
            let spent = measure(|| {
                processed = renderer.render_parts(step.parts, quantum, &mut block);
            });
            if spent.count_total > 0 {
                allocating.push((frame, spent.count_total));
            }
            assert_eq!(processed, step.input, "{frame}");
            heard |= block.iter().any(|sample| *sample != 0.0);
            frame += i64::try_from(processed).unwrap();
        }
        Run { allocating, heard }
    }

    #[test]
    fn renders_every_quantum_without_allocating() {
        assert!(measure(|| drop(Renderer::new(RATE))).count_total > 0);
        let mut renderer = opened();
        for step in steps() {
            let Run { allocating, heard } = run(&mut renderer, &step);
            assert!(heard, "{:?}", step.target);
            assert!(
                allocating.is_empty(),
                "{:?} allocates in {} quanta, first (frame, allocations): {:?}",
                step.target,
                allocating.len(),
                allocating.first()
            );
        }
    }
}
