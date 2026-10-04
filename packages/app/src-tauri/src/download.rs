use std::{
    collections::HashMap,
    fs::{copy, create_dir_all, remove_dir_all},
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard, PoisonError},
    time::{SystemTime, UNIX_EPOCH},
};

use tauri::{Manager, Runtime, Webview, webview::DownloadEvent};
use tauri_plugin_dialog::DialogExt;

const STAGING_AREA: &str = "downloads";

#[derive(Default)]
pub(crate) struct Downloads(Mutex<HashMap<String, PathBuf>>);

impl Downloads {
    fn lock(&self) -> MutexGuard<'_, HashMap<String, PathBuf>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

pub(crate) fn handle<R: Runtime>(webview: &Webview<R>, event: DownloadEvent<'_>) -> bool {
    match event {
        DownloadEvent::Requested { url, destination } => {
            stage(webview, url.as_str(), destination);
        }
        DownloadEvent::Finished { url, success, .. } => {
            finish(webview, url.as_str(), success);
        }
        _ => {}
    }
    true
}

fn stage<R: Runtime>(webview: &Webview<R>, url: &str, destination: &mut PathBuf) {
    let Some(name) = destination.file_name().map(ToOwned::to_owned) else {
        return;
    };
    let Ok(cache) = webview.path().app_cache_dir() else {
        return;
    };
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos());
    let area = cache.join(STAGING_AREA).join(stamp.to_string());
    if let Err(error) = create_dir_all(&area) {
        log::warn!("download staging failed: {error}");
        return;
    }
    let staged = area.join(name);
    webview
        .state::<Downloads>()
        .lock()
        .insert(url.to_owned(), staged.clone());
    *destination = staged;
}

fn finish<R: Runtime>(webview: &Webview<R>, url: &str, success: bool) {
    let Some(staged) = webview.state::<Downloads>().lock().remove(url) else {
        return;
    };
    if !success {
        discard(&staged);
        return;
    }
    let name = staged
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    webview
        .dialog()
        .file()
        .set_file_name(name)
        .save_file(move |chosen| {
            if let Some(path) = chosen.and_then(|file| file.into_path().ok())
                && let Err(error) = copy(&staged, &path)
            {
                log::warn!("download save failed: {error}");
            }
            discard(&staged);
        });
}

fn discard(staged: &Path) {
    if let Some(area) = staged.parent() {
        let _ = remove_dir_all(area);
    }
}
