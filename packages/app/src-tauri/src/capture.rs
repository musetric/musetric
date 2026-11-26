mod chunk;
#[cfg(target_os = "macos")]
mod coreaudio;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(any(target_os = "windows", target_os = "macos"))]
mod plugin;
#[cfg(any(target_os = "windows", target_os = "macos"))]
mod system;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) use plugin::init;
