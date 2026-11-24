mod chunk;
#[cfg(target_os = "windows")]
mod plugin;
#[cfg(target_os = "windows")]
mod system;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "windows")]
pub(crate) use plugin::init;
