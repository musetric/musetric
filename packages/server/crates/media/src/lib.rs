mod convert;
#[cfg(test)]
mod fixture;
mod flac;
mod frames;
mod loudness;
mod mono;
mod pcm;
mod peaks;
mod resample;
mod run;

use std::path::PathBuf;

pub use convert::{convert_to_flac, convert_to_fmp4, encode_flac_from_raw};
pub use frames::read_frame_count;
pub use loudness::{LeadVisualLoudness, Loudness, analyze_lead_visual_loudness, analyze_loudness};
pub use mono::{Downmix, decode_mono_pcm};
pub use pcm::decode_interleaved_pcm;
pub use peaks::{WAVE_PEAK_COUNT, generate_wave_peaks};
pub use resample::SampleRates;
pub use run::BoxedError;

pub struct Tools {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
}
