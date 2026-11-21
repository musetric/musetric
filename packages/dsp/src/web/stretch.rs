use std::cell::RefCell;

use wasm_bindgen::prelude::wasm_bindgen;

use crate::{
    page_mix::{LoopRange, MixRequest, PageMixer, PageShape},
    stretch::{Planar, PlanarMut, StretchStream},
};

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

struct Mixer {
    mixer: PageMixer,
    volumes: Vec<f32>,
}

thread_local! {
    static MIXERS: RefCell<Vec<Mixer>> = const { RefCell::new(Vec::new()) };
}

fn with_mixer<Value>(handle: usize, act: impl FnOnce(&mut Mixer) -> Value) -> Value {
    MIXERS.with_borrow_mut(|mixers| act(&mut mixers[handle]))
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "a frame from JavaScript is a whole number far below i64::MAX"
)]
fn to_frame(frame: f64) -> i64 {
    frame as i64
}

#[wasm_bindgen(js_name = openMixer)]
#[must_use]
pub fn open_mixer(channels: usize, stem_count: usize) -> usize {
    MIXERS.with_borrow_mut(|mixers| {
        mixers.push(Mixer {
            mixer: PageMixer::new(channels, stem_count),
            volumes: vec![1.0; stem_count],
        });
        mixers.len() - 1
    })
}

#[wasm_bindgen(js_name = setMixerStem)]
#[must_use]
pub fn set_mixer_stem(handle: usize, stem: usize, frame_count: usize, page_starts: &[u32]) -> bool {
    let starts: Vec<i64> = page_starts.iter().copied().map(i64::from).collect();
    let Ok(frames) = i64::try_from(frame_count) else {
        return false;
    };
    with_mixer(handle, |mixer| {
        mixer.mixer.set_stem(stem, frames, &starts).is_ok()
    })
}

#[wasm_bindgen(js_name = mixerPageInput)]
#[must_use]
pub fn mixer_page_input(handle: usize, stem: usize, index: usize, sample_count: usize) -> usize {
    with_mixer(handle, |mixer| {
        let Some(frames) = mixer.mixer.page_frames(stem, index) else {
            return 0;
        };
        if frames == 0 || !sample_count.is_multiple_of(frames) {
            return 0;
        }
        let shape = PageShape {
            stem,
            index,
            frames,
            channels: sample_count / frames,
        };
        mixer
            .mixer
            .page_input(shape)
            .map_or(0, |input| input.as_ptr().addr())
    })
}

#[wasm_bindgen(js_name = dropMixerPage)]
pub fn drop_mixer_page(handle: usize, stem: usize, index: usize) {
    with_mixer(handle, |mixer| {
        mixer.mixer.drop_page(stem, index).ok();
    });
}

#[wasm_bindgen(js_name = setMixerVolumes)]
pub fn set_mixer_volumes(handle: usize, volumes: &[f32]) {
    with_mixer(handle, |mixer| {
        mixer.volumes = volumes.to_vec();
    });
}

#[wasm_bindgen(js_name = setMixerRange)]
pub fn set_mixer_range(handle: usize, cycle: bool, frames: &[f64]) {
    let range = match frames {
        [from, to, end] => Some(LoopRange {
            from: to_frame(*from),
            to: to_frame(*to),
            end: to_frame(*end),
            cycle,
        }),
        _ => None,
    };
    with_mixer(handle, |mixer| mixer.mixer.set_range(range));
}

#[wasm_bindgen(js_name = mixerReady)]
#[must_use]
pub fn mixer_ready(handle: usize, frame: f64) -> bool {
    with_mixer(handle, |mixer| mixer.mixer.ready(to_frame(frame)))
}

#[wasm_bindgen(js_name = mixStems)]
#[must_use]
pub fn mix_stems(handle: usize, first: f64, count: usize, mask: u32) -> usize {
    with_mixer(handle, |mixer| {
        let request = MixRequest {
            first: to_frame(first),
            count,
            mask,
        };
        let Mixer { mixer, volumes } = mixer;
        mixer.mix(request, volumes).as_ptr().addr()
    })
}
