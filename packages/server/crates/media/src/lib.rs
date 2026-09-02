mod convert;
mod frames;
mod loudness;
mod pcm;
mod peaks;
mod run;

use std::path::PathBuf;

pub use convert::{convert_to_flac, convert_to_fmp4};
pub use frames::read_frame_count;
pub use loudness::{LeadVisualLoudness, Loudness, analyze_lead_visual_loudness, analyze_loudness};
pub use peaks::{WAVE_PEAK_COUNT, generate_wave_peaks};
pub use run::BoxedError;

pub struct Tools {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
}
