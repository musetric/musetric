use std::cell::RefCell;

use wasm_bindgen::prelude::wasm_bindgen;

use crate::{
    page_mix::{LoopRange, PageShape},
    render::{CHANNELS, Piece, QUANTUM, Quantum, Renderer},
};

struct Player {
    renderer: Renderer,
    output: Vec<f32>,
}

thread_local! {
    static PLAYERS: RefCell<Vec<Player>> = const { RefCell::new(Vec::new()) };
}

fn with_player<Value>(handle: usize, act: impl FnOnce(&mut Player) -> Value) -> Value {
    PLAYERS.with_borrow_mut(|players| act(&mut players[handle]))
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "a frame from JavaScript is a whole number far below i64::MAX"
)]
const fn to_frame(frame: f64) -> i64 {
    frame as i64
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "a transpose or an octave from JavaScript is a small whole number"
)]
const fn to_semitones(value: f64) -> i32 {
    value as i32
}

#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "a track or a frame count from JavaScript is a whole number that is not negative"
)]
const fn to_count(value: f64) -> usize {
    value as usize
}

fn piece_of([track, song_start, tempo, transpose, octave, frame_count]: &[f64; 6]) -> Piece {
    Piece {
        song_start: *song_start,
        tempo: *tempo,
        transpose: to_semitones(*transpose),
        octave: to_semitones(*octave),
        track: to_count(*track),
        frame_count: to_count(*frame_count),
    }
}

#[wasm_bindgen(js_name = openRenderer)]
#[must_use]
pub fn open_renderer(sample_rate: u32) -> usize {
    PLAYERS.with_borrow_mut(|players| {
        players.push(Player {
            renderer: Renderer::new(sample_rate),
            output: Vec::with_capacity(CHANNELS * QUANTUM),
        });
        players.len() - 1
    })
}

#[wasm_bindgen(js_name = setRendererTrack)]
#[must_use]
pub fn set_renderer_track(
    handle: usize,
    track: usize,
    frame_count: usize,
    page_starts: &[u32],
) -> bool {
    let starts: Vec<i64> = page_starts.iter().copied().map(i64::from).collect();
    let Ok(frames) = i64::try_from(frame_count) else {
        return false;
    };
    with_player(handle, |player| {
        player
            .renderer
            .mixer()
            .set_track(track, frames, &starts)
            .is_ok()
    })
}

#[wasm_bindgen(js_name = setRendererTakes)]
#[must_use]
pub fn set_renderer_takes(handle: usize, pieces: &[f64]) -> bool {
    let (rows, rest) = pieces.as_chunks::<6>();
    let pieces = rows.iter().map(piece_of).collect();
    rest.is_empty() && with_player(handle, |player| player.renderer.set_takes(pieces).is_ok())
}

#[wasm_bindgen(js_name = rendererPageInput)]
#[must_use]
pub fn renderer_page_input(
    handle: usize,
    track: usize,
    index: usize,
    sample_count: usize,
) -> usize {
    with_player(handle, |player| {
        let mixer = player.renderer.mixer();
        let Some(frames) = mixer.page_frames(track, index) else {
            return 0;
        };
        if frames == 0 || !sample_count.is_multiple_of(frames) {
            return 0;
        }
        let shape = PageShape {
            track,
            index,
            frames,
            channels: sample_count / frames,
        };
        mixer
            .page_input(shape)
            .map_or(0, |input| input.as_ptr().addr())
    })
}

#[wasm_bindgen(js_name = reserveRendererPages)]
pub fn reserve_renderer_pages(handle: usize, count: usize) {
    with_player(handle, |player| {
        player.renderer.mixer().reserve_pages(count);
    });
}

#[wasm_bindgen(js_name = dropRendererPage)]
pub fn drop_renderer_page(handle: usize, track: usize, index: usize) {
    with_player(handle, |player| {
        player.renderer.mixer().drop_page(track, index).ok();
    });
}

#[wasm_bindgen(js_name = rendererReady)]
#[must_use]
pub fn renderer_ready(handle: usize, frame: f64) -> bool {
    with_player(handle, |player| player.renderer.ready(to_frame(frame)))
}

#[wasm_bindgen(js_name = setRendererVolumes)]
pub fn set_renderer_volumes(handle: usize, volumes: &[f32]) {
    with_player(handle, |player| player.renderer.set_volumes(volumes));
}

#[wasm_bindgen(js_name = setRendererRange)]
pub fn set_renderer_range(handle: usize, cycle: bool, frames: &[f64]) {
    let range = match frames {
        [from, to, end] => Some(LoopRange {
            from: to_frame(*from),
            to: to_frame(*to),
            end: to_frame(*end),
            cycle,
        }),
        _ => None,
    };
    with_player(handle, |player| player.renderer.set_range(range));
}

#[wasm_bindgen(js_name = setRendererTempo)]
pub fn set_renderer_tempo(handle: usize, tempo: f64) {
    with_player(handle, |player| player.renderer.set_tempo(tempo));
}

#[wasm_bindgen(js_name = setRendererTranspose)]
pub fn set_renderer_transpose(handle: usize, semitones: i32) {
    with_player(handle, |player| player.renderer.set_transpose(semitones));
}

#[wasm_bindgen(js_name = setRendererVoice)]
pub fn set_renderer_voice(handle: usize, octave: i32, shifted: bool) {
    with_player(handle, |player| player.renderer.set_voice(octave, shifted));
}

#[wasm_bindgen(js_name = setRendererRecordingVolume)]
pub fn set_renderer_recording_volume(handle: usize, volume: f32) {
    with_player(handle, |player| {
        player.renderer.set_recording_volume(volume);
    });
}

#[wasm_bindgen(js_name = resetRenderer)]
pub fn reset_renderer(handle: usize) {
    with_player(handle, |player| player.renderer.reset());
}

#[wasm_bindgen(js_name = refillRenderer)]
pub fn refill_renderer(handle: usize) {
    with_player(handle, |player| player.renderer.refill());
}

#[wasm_bindgen(js_name = renderQuantum)]
#[must_use]
pub fn render_quantum(handle: usize, frame: f64, take_frame: f64, frames: usize) -> usize {
    with_player(handle, |player| {
        player.output.resize(CHANNELS * frames, 0.0);
        let quantum = Quantum {
            frame: to_frame(frame),
            take_frame: (!take_frame.is_nan()).then_some(take_frame),
        };
        player.renderer.render(quantum, &mut player.output)
    })
}

#[wasm_bindgen(js_name = rendererOutput)]
#[must_use]
pub fn renderer_output(handle: usize) -> usize {
    with_player(handle, |player| player.output.as_ptr().addr())
}
