use std::{
    io,
    path::{Path, PathBuf},
};

use musetric_server::{MigrationFailure, StorageLock, lock_storage};
use tauri::{Manager, Runtime};

const APPLICATION_NAME: &str = "Musetric";
const DEVELOPMENT_APPLICATION_NAME: &str = "Musetric Dev";
const LOG_FILE_NAME: &str = "musetric.log";
const LOGS_DIRECTORY: &str = "logs";
pub(crate) fn application_data_dir<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<PathBuf> {
    let name = if cfg!(development) {
        DEVELOPMENT_APPLICATION_NAME
    } else {
        APPLICATION_NAME
    };
    Ok(app.path().local_data_dir()?.join(name))
}

pub(crate) fn logs_dir(root: &Path) -> PathBuf {
    root.join(LOGS_DIRECTORY)
}

pub(crate) fn log_path(root: &Path) -> PathBuf {
    logs_dir(root).join(LOG_FILE_NAME)
}

pub(crate) fn database_path(root: &Path) -> PathBuf {
    root.join("storage").join("db").join("app.db")
}

pub(crate) fn acquire_storage_lock(root: &Path) -> io::Result<Option<StorageLock>> {
    lock_storage(&database_path(root)).map_err(io::Error::other)
}

pub(crate) fn storage_busy_message() -> (&'static str, String) {
    (
        "Musetric is already running",
        "Another Musetric process is using the same data folder. Close it and try again.".into(),
    )
}

pub(crate) fn startup_failure_message(
    error: &(dyn std::error::Error + Send + Sync + 'static),
    logs: &Path,
) -> (&'static str, String) {
    let Some(migration) = error.downcast_ref::<MigrationFailure>() else {
        return (
            "Musetric could not start",
            format!("{error}\n\nThe details are in {}", logs.display()),
        );
    };
    let mut lines = vec![migration.to_string()];
    if let Some(backup) = migration.backup_path() {
        lines.push(format!(
            "A copy of the database from before the update is in {}.",
            backup.display()
        ));
        if let Some(database_directory) = backup.parent().and_then(Path::parent) {
            lines.push(format!(
                "To restore it, close Musetric, delete app.db, app.db-wal and app.db-shm in {}, then copy the backup there under the name app.db.",
                database_directory.display()
            ));
        }
    }
    lines.push(format!("The details are in {}", logs.display()));
    ("Musetric could not update its database", lines.join("\n\n"))
}
