mod convert;
mod decode;
mod file;
mod frames;
mod loudness;
mod mixdown;
mod mono;
mod pcm;
mod peaks;

pub use convert::{convert_to_flac, encode_flac_from_raw};
pub use decode::SymphoniaPcm;
pub use frames::{read_flac_sample_rate, read_frame_count};
pub use loudness::{analyze_lead_visual_loudness, analyze_loudness};
pub use mixdown::{
    Mixdown, MixdownChange, MixdownFormat, MixdownGroup, MixdownProgress, MixdownStage,
    MixdownTake, MixdownTrack, MixdownWatch, write_mixdown,
};
pub use mono::{MonoRequest, decode_mono_pcm};
pub use pcm::{
    DecodedFrames, PcmRequest, PcmSink, PcmSource, ReadingPcm, SourceFailure,
    collect_interleaved_pcm,
};
pub use peaks::{WavePeaks, generate_wave_peaks};

pub type BoxedError = musetric_dsp::BoxedError;
