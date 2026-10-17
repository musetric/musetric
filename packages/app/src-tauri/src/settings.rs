use std::{io, process::Command};

use tauri::Url;

const SETTINGS_SCHEMES: [&str; 2] = ["ms-settings", "x-apple.systempreferences"];

pub(crate) fn allow_navigation(url: &Url) -> bool {
    if !SETTINGS_SCHEMES.contains(&url.scheme()) {
        return true;
    }
    if let Err(error) = open(url.as_str()) {
        log::error!("could not open the system settings: {error}");
    }
    false
}

#[cfg(target_os = "windows")]
fn open(url: &str) -> io::Result<()> {
    Command::new("explorer").arg(url).status().map(drop)
}

#[cfg(target_os = "macos")]
fn open(url: &str) -> io::Result<()> {
    Command::new("open").arg(url).status().map(drop)
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn open(url: &str) -> io::Result<()> {
    Command::new("xdg-open").arg(url).status().map(drop)
}
