mod aac;
mod convert;
mod decode;
#[cfg(test)]
mod fixture;
mod flac;
mod fmp4;
mod frames;
mod loudness;
mod mono;
mod pcm;
mod peaks;
mod resample;

use std::error::Error;

pub use aac::{AacEncoder, FRAME_SAMPLES};
pub use convert::{convert_to_flac, convert_to_fmp4, encode_flac_from_raw};
pub use decode::SymphoniaPcm;
pub use frames::read_frame_count;
pub use loudness::{LeadVisualLoudness, Loudness, analyze_lead_visual_loudness, analyze_loudness};
pub use mono::{Downmix, decode_mono_pcm};
pub use pcm::{PcmRequest, PcmSink, PcmSource, ReadingPcm, collect_interleaved_pcm};
pub use peaks::{WAVE_PEAK_COUNT, WavePeaks, generate_wave_peaks};
pub use resample::SampleRates;

pub type BoxedError = Box<dyn Error + Send + Sync>;
