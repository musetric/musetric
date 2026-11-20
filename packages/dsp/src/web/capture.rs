use std::cell::RefCell;

use wasm_bindgen::prelude::wasm_bindgen;

use crate::capture::CaptureRing;

#[derive(Default)]
struct Capture {
    ring: CaptureRing,
    input: Vec<f32>,
    output: Vec<f32>,
}

thread_local! {
    static CAPTURES: RefCell<Vec<Capture>> = const { RefCell::new(Vec::new()) };
}

fn with_capture<Value>(handle: usize, act: impl FnOnce(&mut Capture) -> Value) -> Value {
    CAPTURES.with_borrow_mut(|captures| act(&mut captures[handle]))
}

#[wasm_bindgen(js_name = openCapture)]
#[must_use]
pub fn open_capture() -> usize {
    CAPTURES.with_borrow_mut(|captures| {
        captures.push(Capture::default());
        captures.len() - 1
    })
}

#[wasm_bindgen(js_name = setCaptureStep)]
pub fn set_capture_step(handle: usize, step: f64) {
    with_capture(handle, |capture| capture.ring.set_step(step));
}

#[wasm_bindgen(js_name = captureInput)]
#[must_use]
pub fn capture_input(handle: usize, length: usize) -> usize {
    with_capture(handle, |capture| {
        if capture.input.len() < length {
            capture.input.resize(length, 0.0);
        }
        capture.input.as_ptr().addr()
    })
}

#[wasm_bindgen(js_name = writeCapture)]
#[expect(
    clippy::cast_possible_truncation,
    reason = "a frame from JavaScript is a whole number far below i64::MAX"
)]
pub fn write_capture(handle: usize, frame: f64, length: usize) {
    with_capture(handle, |capture| {
        capture.ring.write(frame as i64, &capture.input[..length]);
    });
}

#[wasm_bindgen(js_name = renderCapture)]
#[must_use]
pub fn render_capture(handle: usize, at: f64, ratio: f64, length: usize) -> f64 {
    with_capture(handle, |capture| {
        if capture.output.len() < length {
            capture.output.resize(length, 0.0);
        }
        capture
            .ring
            .render(&mut capture.output[..length], at, ratio)
    })
}

#[wasm_bindgen(js_name = captureOutput)]
#[must_use]
pub fn capture_output(handle: usize) -> usize {
    with_capture(handle, |capture| capture.output.as_ptr().addr())
}

#[wasm_bindgen(js_name = clearCapture)]
pub fn clear_capture(handle: usize) {
    with_capture(handle, |capture| capture.ring.clear());
}
