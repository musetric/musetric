pub mod aac;
pub mod decode;
pub mod depth;
pub mod flac;
pub mod flac_feed;
pub mod loudness;
pub mod m4a;
pub mod mix;
pub mod mono;
pub mod mp3;
mod mp4box;
pub mod peaks;
pub mod resample;
pub mod stretch;
pub mod wav;
#[cfg(target_arch = "wasm32")]
pub mod web;

pub type BoxedError = Box<dyn std::error::Error + Send + Sync>;

pub const CHANNELS: usize = 2;
