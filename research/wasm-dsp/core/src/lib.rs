pub type BoxedError = Box<dyn std::error::Error + Send + Sync>;

pub(crate) mod pcm {
    pub(crate) const CHANNELS: usize = 2;
}

#[cfg(feature = "resample")]
#[path = "../../../../packages/server/crates/media/src/resample.rs"]
#[allow(dead_code)]
mod resample;

#[cfg(feature = "encode")]
#[path = "../../../../packages/server/crates/media/src/aac.rs"]
#[allow(dead_code)]
mod aac;

#[cfg(feature = "encode")]
#[path = "../../../../packages/server/crates/media/src/depth.rs"]
#[allow(dead_code)]
mod depth;

#[cfg(feature = "decode")]
mod decode;
#[cfg(feature = "encode")]
mod encode;

#[cfg(target_arch = "wasm32")]
mod wasm;

#[cfg(any(feature = "resample", feature = "stretch"))]
use pcm::CHANNELS;

#[cfg(not(target_arch = "wasm32"))]
#[must_use]
pub fn work_dir() -> std::path::PathBuf {
    std::env::var_os("WASM_DSP_WORK").map_or_else(
        || std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../../tmp/wasm-dsp"),
        std::path::PathBuf::from,
    )
}

#[cfg(feature = "resample")]
pub fn resample(interleaved: &[f32], input: u32, output: u32) -> Result<Vec<f32>, BoxedError> {
    let mut conversion = resample::Conversion::create(resample::SampleRates { input, output })?;
    let mut out = Vec::new();
    for chunk in interleaved.chunks(4096 * CHANNELS) {
        out.extend_from_slice(conversion.convert(chunk)?);
    }
    out.extend_from_slice(conversion.flush(interleaved.len() / CHANNELS)?);
    Ok(out)
}

#[cfg(feature = "decode")]
pub use decode::{decode, decode_window};

#[cfg(feature = "encode")]
pub use encode::{encode_aac, encode_flac, encode_mp3};

#[cfg(feature = "stretch")]
pub fn stretch(
    interleaved: &[f32],
    sample_rate: u32,
    semitones: i32,
    tempo_percent: usize,
    keep_formants: bool,
) -> Result<Vec<f32>, BoxedError> {
    let source_frames = interleaved.len() / CHANNELS;
    let frame_count = (source_frames * 100 + tempo_percent / 2) / tempo_percent;
    let mut channels = vec![Vec::with_capacity(source_frames); CHANNELS];
    for frame in interleaved.chunks_exact(CHANNELS) {
        for (channel, sample) in frame.iter().enumerate() {
            channels[channel].push(*sample);
        }
    }
    let stretch = musetric_stretch::Stretch {
        sample_rate,
        frame_count,
        semitones,
        keep_formants,
    };
    let planar = stretch
        .apply(&channels, &mut |_| true)
        .map_err(|refusal| format!("{refusal:?}"))?;
    let mut out = Vec::with_capacity(frame_count * CHANNELS);
    for frame in 0..planar[0].len() {
        for channel in &planar {
            out.push(channel[frame]);
        }
    }
    Ok(out)
}
