use std::io::Cursor;

use wasm_bindgen::prelude::{JsError, wasm_bindgen};

use crate::{
    BoxedError, CHANNELS,
    aac::{AacEncoder, ENCODER_DELAY},
    decode::{DecodeRequest, Decoder, Layout},
    depth::SampleDepth,
    flac::FlacWriter,
    flac_feed,
    loudness::LoudnessMeter,
    m4a::{M4aTrack, write_m4a},
    mp3::Mp3Encoder,
    peaks::WavePeaks,
    resample::{Conversion, SampleRates},
    stretch::{Refusal, Stretch},
    wav::WavWriter,
};

const UNKNOWN_DEPTH: &str = "The bit depth is neither 16 nor 24";
const TOO_SHORT: &str = "The audio is too short to change its tempo or key";
const STOPPED: &str = "The stretch was stopped";

fn failed(failure: &BoxedError) -> JsError {
    JsError::new(&failure.to_string())
}

fn depth_of(bits: u32) -> Result<SampleDepth, BoxedError> {
    match bits {
        16 => Ok(SampleDepth::Sixteen),
        24 => Ok(SampleDepth::TwentyFour),
        _ => Err(UNKNOWN_DEPTH.into()),
    }
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

#[wasm_bindgen(js_name = aacEncoderDelay)]
#[must_use]
pub fn aac_encoder_delay() -> u32 {
    ENCODER_DELAY
}

#[wasm_bindgen]
pub struct FlacFeed {
    feed: flac_feed::FlacFeed,
}

#[wasm_bindgen]
impl FlacFeed {
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new(sample_rate: Option<u32>, lead_in_frames: usize) -> FlacFeed {
        Self {
            feed: flac_feed::FlacFeed::create(sample_rate, lead_in_frames),
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

    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<f32>, JsError> {
        self.feed
            .push(bytes)
            .map(<[f32]>::to_vec)
            .map_err(|failure| failed(&failure))
    }

    pub fn finish(&mut self) -> Result<Vec<f32>, JsError> {
        self.feed
            .finish()
            .map(<[f32]>::to_vec)
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

#[wasm_bindgen(js_name = encodeFlac)]
pub fn encode_flac(samples: &[f32], sample_rate: u32, bits: u32) -> Result<Vec<u8>, JsError> {
    let encoded = || -> Result<Vec<u8>, BoxedError> {
        let mut writer = FlacWriter::create(Cursor::new(Vec::new()), sample_rate, depth_of(bits)?)?;
        for frame in samples.as_chunks::<CHANNELS>().0 {
            writer.push(frame[0], frame[1]);
        }
        Ok(writer.finish()?.into_inner())
    };
    encoded().map_err(|failure| failed(&failure))
}

#[wasm_bindgen(js_name = encodeWav)]
pub fn encode_wav(samples: &[f32], sample_rate: u32, bits: u32) -> Result<Vec<u8>, JsError> {
    let encoded = || -> Result<Vec<u8>, BoxedError> {
        let frames = samples.as_chunks::<CHANNELS>().0;
        let mut writer = WavWriter::create(Vec::new(), sample_rate, depth_of(bits)?, frames.len())?;
        for frame in frames {
            writer.push(frame[0], frame[1])?;
        }
        writer.finish()
    };
    encoded().map_err(|failure| failed(&failure))
}

#[wasm_bindgen(js_name = encodeM4a)]
pub fn encode_m4a(samples: &[f32], sample_rate: u32, bitrate: u32) -> Result<Vec<u8>, JsError> {
    let encoded = || -> Result<Vec<u8>, BoxedError> {
        let channels = u8::try_from(CHANNELS)?;
        let mut encoder = AacEncoder::create(sample_rate, channels, bitrate)?;
        encoder.push(samples)?;
        let packets = encoder.finish()?;
        let track = M4aTrack {
            sample_rate,
            channels,
            packets: &packets,
            frame_count: u32::try_from(samples.len() / CHANNELS)?,
        };
        write_m4a(Vec::new(), &track)
    };
    encoded().map_err(|failure| failed(&failure))
}

#[wasm_bindgen(js_name = encodeMp3)]
pub fn encode_mp3(samples: &[f32], sample_rate: u32, bitrate: u32) -> Result<Vec<u8>, JsError> {
    let encoded = || -> Result<Vec<u8>, BoxedError> {
        let mut encoder = Mp3Encoder::create(sample_rate, bitrate);
        encoder.push(samples)?;
        encoder.finish(Vec::new())
    };
    encoded().map_err(|failure| failed(&failure))
}

#[wasm_bindgen]
pub struct Stretcher {
    sample_rate: u32,
    semitones: i32,
    keep_formants: bool,
}

#[wasm_bindgen]
impl Stretcher {
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new(sample_rate: u32, semitones: i32, keep_formants: bool) -> Stretcher {
        Self {
            sample_rate,
            semitones,
            keep_formants,
        }
    }

    pub fn apply(&self, samples: &[f32], frame_count: usize) -> Result<Vec<f32>, JsError> {
        let channels: Vec<Vec<f32>> = (0..CHANNELS)
            .map(|channel| {
                samples
                    .iter()
                    .skip(channel)
                    .step_by(CHANNELS)
                    .copied()
                    .collect()
            })
            .collect();
        let stretch = Stretch {
            sample_rate: self.sample_rate,
            frame_count,
            semitones: self.semitones,
            keep_formants: self.keep_formants,
        };
        let stretched =
            stretch
                .apply(&channels, &mut |_| true)
                .map_err(|refusal| match refusal {
                    Refusal::TooShort => JsError::new(TOO_SHORT),
                    Refusal::Stopped => JsError::new(STOPPED),
                })?;
        let mut interleaved = Vec::with_capacity(frame_count * CHANNELS);
        for frame in 0..frame_count {
            for channel in &stretched {
                interleaved.push(channel[frame]);
            }
        }
        Ok(interleaved)
    }
}

#[wasm_bindgen]
pub struct Loudness {
    integrated_loudness_db: f64,
    true_peak_db: f64,
}

#[wasm_bindgen]
impl Loudness {
    #[wasm_bindgen(getter, js_name = integratedLoudnessDb)]
    #[must_use]
    pub fn integrated_loudness_db(&self) -> f64 {
        self.integrated_loudness_db
    }

    #[wasm_bindgen(getter, js_name = truePeakDb)]
    #[must_use]
    pub fn true_peak_db(&self) -> f64 {
        self.true_peak_db
    }
}

#[wasm_bindgen(js_name = measureLoudness)]
pub fn measure_loudness(samples: &[f32], sample_rate: u32) -> Result<Loudness, JsError> {
    let measured = || -> Result<Loudness, BoxedError> {
        let mut meter = LoudnessMeter::create(sample_rate)?;
        meter.push(samples);
        let loudness = meter.finish()?;
        Ok(Loudness {
            integrated_loudness_db: loudness.integrated_loudness_db,
            true_peak_db: loudness.true_peak_db,
        })
    };
    measured().map_err(|failure| failed(&failure))
}

#[wasm_bindgen(js_name = wavePeaks)]
#[must_use]
pub fn wave_peaks(samples: &[f32]) -> Vec<f32> {
    let mut peaks = WavePeaks::create((samples.len() / CHANNELS) as u64);
    peaks.push(samples);
    peaks.finish()
}
