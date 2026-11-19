use std::io::Cursor;

use wasm_bindgen::prelude::{JsError, wasm_bindgen};

use crate::{
    BoxedError, CHANNELS,
    decode::{DecodeRequest, Decoder, Layout},
    flac_feed,
    peaks::WavePeaks,
    resample::{Conversion, SampleRates},
};

fn failed(failure: &BoxedError) -> JsError {
    JsError::new(&failure.to_string())
}

#[wasm_bindgen(js_name = Decoder)]
pub struct StreamDecoder {
    decoder: Decoder,
}

#[wasm_bindgen(js_class = Decoder)]
impl StreamDecoder {
    #[wasm_bindgen(constructor)]
    #[expect(
        clippy::needless_pass_by_value,
        reason = "wasm-bindgen hands an optional string over by value"
    )]
    pub fn new(
        bytes: Vec<u8>,
        extension: Option<String>,
        sample_rate: Option<u32>,
        keep_channels: bool,
    ) -> Result<StreamDecoder, JsError> {
        let request = DecodeRequest {
            source: Box::new(Cursor::new(bytes)),
            extension: extension.as_deref(),
            sample_rate,
            layout: if keep_channels {
                Layout::Source
            } else {
                Layout::Stereo
            },
        };
        let decoder = Decoder::open(request).map_err(|failure| failed(&failure))?;
        Ok(Self { decoder })
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn channels(&self) -> usize {
        self.decoder.channels()
    }

    #[wasm_bindgen(getter, js_name = sampleRate)]
    #[must_use]
    pub fn sample_rate(&self) -> u32 {
        self.decoder.sample_rate()
    }

    pub fn read(&mut self) -> Result<Option<Vec<f32>>, JsError> {
        self.decoder
            .read()
            .map(|frames| frames.map(<[f32]>::to_vec))
            .map_err(|failure| failed(&failure))
    }
}

#[wasm_bindgen]
pub struct FlacFeed {
    feed: flac_feed::FlacFeed,
}

#[wasm_bindgen]
impl FlacFeed {
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new(sample_rate: Option<u32>) -> FlacFeed {
        Self {
            feed: flac_feed::FlacFeed::create(sample_rate),
        }
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn channels(&self) -> Option<usize> {
        self.feed.channels()
    }

    #[wasm_bindgen(getter, js_name = frameCount)]
    #[must_use]
    pub fn frame_count(&self) -> Option<usize> {
        self.feed.frame_count()
    }

    #[wasm_bindgen(getter, js_name = readyPointer)]
    #[must_use]
    pub fn ready_pointer(&self) -> usize {
        self.feed.ready().as_ptr().addr()
    }

    pub fn push(&mut self, bytes: &[u8]) -> Result<usize, JsError> {
        self.feed
            .push(bytes)
            .map(<[f32]>::len)
            .map_err(|failure| failed(&failure))
    }

    pub fn finish(&mut self) -> Result<usize, JsError> {
        self.feed
            .finish()
            .map(<[f32]>::len)
            .map_err(|failure| failed(&failure))
    }
}

#[wasm_bindgen]
pub struct Resampler {
    conversion: Conversion,
}

#[wasm_bindgen]
impl Resampler {
    #[wasm_bindgen(constructor)]
    pub fn new(input: u32, output: u32, channels: usize) -> Result<Resampler, JsError> {
        let conversion = Conversion::create(SampleRates { input, output }, channels)
            .map_err(|failure| failed(&failure))?;
        Ok(Self { conversion })
    }

    pub fn convert(&mut self, frames: &[f32]) -> Result<Vec<f32>, JsError> {
        self.conversion
            .convert(frames)
            .map(<[f32]>::to_vec)
            .map_err(|failure| failed(&failure))
    }

    pub fn flush(&mut self, input_frames: usize) -> Result<Vec<f32>, JsError> {
        self.conversion
            .flush(input_frames)
            .map(<[f32]>::to_vec)
            .map_err(|failure| failed(&failure))
    }
}

#[wasm_bindgen(js_name = wavePeaks)]
#[must_use]
pub fn wave_peaks(samples: &[f32]) -> Vec<f32> {
    let mut peaks = WavePeaks::create((samples.len() / CHANNELS) as u64);
    peaks.push(samples);
    peaks.finish()
}
