use std::{sync::Mutex, time::Duration};

use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};

const FIRST_CHECK: Duration = Duration::from_secs(90);
const CHECK_EVERY: Duration = Duration::from_hours(4);

struct PendingInstall {
    update: Update,
    bytes: Vec<u8>,
}

pub(crate) fn start<R: Runtime>(app: &AppHandle<R>) {
    if cfg!(debug_assertions) {
        return;
    }
    app.manage(Mutex::new(None::<PendingInstall>));
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK).await;
        loop {
            if let Err(error) = check_once(&handle).await {
                log::error!("update check failed: {error}");
            }
            tokio::time::sleep(CHECK_EVERY).await;
        }
    });
}

pub(crate) fn install_on_exit<R: Runtime>(app: &AppHandle<R>) {
    let Some(pending) = app.try_state::<Mutex<Option<PendingInstall>>>() else {
        return;
    };
    let Some(downloaded) = pending.lock().ok().and_then(|mut slot| slot.take()) else {
        return;
    };
    if let Err(error) = downloaded.update.install(downloaded.bytes) {
        log::error!("could not install the downloaded update: {error}");
    }
}

async fn check_once<R: Runtime>(app: &AppHandle<R>) -> tauri_plugin_updater::Result<()> {
    let Some(update) = app.updater()?.check().await? else {
        return Ok(());
    };
    log::info!("update {} is available, downloading", update.version);
    let bytes = update.download(|_, _| {}, || {}).await?;
    let Some(pending) = app.try_state::<Mutex<Option<PendingInstall>>>() else {
        return Ok(());
    };
    if let Ok(mut slot) = pending.lock() {
        log::info!(
            "update {} downloaded, it will install on quit",
            update.version
        );
        *slot = Some(PendingInstall { update, bytes });
    }
    Ok(())
}
