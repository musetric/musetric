pub mod aac;
pub mod capture;
pub mod decode;
mod dither;
pub mod flac;
pub mod flac_feed;
pub mod flac_pages;
pub mod loudness;
pub mod m4a;
pub mod mix;
pub mod mono;
pub mod mp3;
mod mp4box;
pub mod page_mix;
pub mod peaks;
pub mod render;
pub mod resample;
pub mod stretch;
pub mod wav;
#[cfg(target_arch = "wasm32")]
pub mod web;

pub type BoxedError = Box<dyn std::error::Error + Send + Sync>;

pub const CHANNELS: usize = 2;
pub const SAMPLE_BITS: usize = 16;
