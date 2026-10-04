mod aac;
mod convert;
mod decode;
mod depth;
mod flac;
mod fmp4;
mod frames;
mod loudness;
mod m4a;
mod mixdown;
mod mono;
mod mp4box;
mod pcm;
mod peaks;
mod resample;
mod wav;

use std::error::Error;

pub use aac::{AacEncoder, ENCODER_DELAY, FRAME_SAMPLES};
pub use convert::{convert_to_flac, convert_to_fmp4, encode_flac_from_raw};
pub use decode::SymphoniaPcm;
pub use depth::SampleDepth;
pub use frames::{read_flac_sample_rate, read_frame_count};
pub use loudness::{LeadVisualLoudness, Loudness, analyze_lead_visual_loudness, analyze_loudness};
pub use mixdown::{Mixdown, MixdownChannels, MixdownFormat, MixdownTrack, write_mixdown};
pub use mono::{Downmix, MonoRequest, decode_mono_pcm};
pub use pcm::{
    DecodedFrames, PcmRequest, PcmSink, PcmSource, ReadingPcm, SourceFailure,
    collect_interleaved_pcm,
};
pub use peaks::{WAVE_PEAK_COUNT, WavePeaks, generate_wave_peaks};
pub use resample::SampleRates;

pub type BoxedError = Box<dyn Error + Send + Sync>;
