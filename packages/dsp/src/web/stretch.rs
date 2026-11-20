use std::cell::RefCell;

use wasm_bindgen::prelude::wasm_bindgen;

use crate::stretch::{Planar, PlanarMut, StretchStream};

struct Stretcher {
    stream: StretchStream,
    channels: usize,
    length: usize,
    buffers: Vec<f32>,
}

thread_local! {
    static STRETCHERS: RefCell<Vec<Stretcher>> = const { RefCell::new(Vec::new()) };
}

fn with_stretcher<Value>(handle: usize, act: impl FnOnce(&mut Stretcher) -> Value) -> Value {
    STRETCHERS.with_borrow_mut(|stretchers| act(&mut stretchers[handle]))
}

#[wasm_bindgen(js_name = openStretcher)]
#[must_use]
pub fn open_stretcher(channels: usize, sample_rate: u32) -> usize {
    STRETCHERS.with_borrow_mut(|stretchers| {
        stretchers.push(Stretcher {
            stream: StretchStream::new(channels, sample_rate),
            channels,
            length: 0,
            buffers: Vec::new(),
        });
        stretchers.len() - 1
    })
}

#[wasm_bindgen(js_name = stretcherInputLatency)]
#[must_use]
pub fn stretcher_input_latency(handle: usize) -> usize {
    with_stretcher(handle, |stretcher| stretcher.stream.input_latency())
}

#[wasm_bindgen(js_name = stretcherOutputLatency)]
#[must_use]
pub fn stretcher_output_latency(handle: usize) -> usize {
    with_stretcher(handle, |stretcher| stretcher.stream.output_latency())
}

#[wasm_bindgen(js_name = stretcherSeekLength)]
#[must_use]
pub fn stretcher_seek_length(handle: usize) -> usize {
    with_stretcher(handle, |stretcher| stretcher.stream.seek_length())
}

#[wasm_bindgen(js_name = setStretcherBuffers)]
#[must_use]
pub fn set_stretcher_buffers(handle: usize, length: usize) -> usize {
    with_stretcher(handle, |stretcher| {
        stretcher.length = length;
        stretcher.buffers = vec![0.0; stretcher.channels * length * 2];
        stretcher.buffers.as_ptr().addr()
    })
}

#[wasm_bindgen(js_name = resetStretcher)]
pub fn reset_stretcher(handle: usize) {
    with_stretcher(handle, |stretcher| stretcher.stream.reset());
}

#[wasm_bindgen(js_name = setStretcherSemitones)]
pub fn set_stretcher_semitones(handle: usize, semitones: i32) {
    with_stretcher(handle, |stretcher| {
        stretcher.stream.set_semitones(semitones);
    });
}

#[wasm_bindgen(js_name = setStretcherFormants)]
pub fn set_stretcher_formants(handle: usize, keep_formants: bool) {
    with_stretcher(handle, |stretcher| {
        stretcher.stream.set_keep_formants(keep_formants);
    });
}

#[wasm_bindgen(js_name = seekStretcher)]
pub fn seek_stretcher(handle: usize, input_frames: usize, rate: f64) {
    with_stretcher(handle, |stretcher| {
        let (inputs, _) = stretcher
            .buffers
            .split_at(stretcher.channels * stretcher.length);
        let window = Planar {
            samples: inputs,
            stride: stretcher.length,
            frames: input_frames,
        };
        stretcher.stream.seek(&window, rate);
    });
}

#[wasm_bindgen(js_name = processStretcher)]
pub fn process_stretcher(handle: usize, input_frames: usize, output_frames: usize) {
    with_stretcher(handle, |stretcher| {
        let (inputs, outputs) = stretcher
            .buffers
            .split_at_mut(stretcher.channels * stretcher.length);
        let input = Planar {
            samples: inputs,
            stride: stretcher.length,
            frames: input_frames,
        };
        let mut output = PlanarMut {
            samples: outputs,
            stride: stretcher.length,
            frames: output_frames,
        };
        stretcher.stream.process(&input, &mut output);
    });
}
