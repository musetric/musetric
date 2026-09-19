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
    let name = if cfg!(debug_assertions) {
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

#[cfg(test)]
mod tests {
    use std::{
        fs::remove_dir_all,
        io,
        path::{Path, PathBuf},
        process,
    };

    use musetric_server::MigrationFailure;

    use super::{acquire_storage_lock, log_path, startup_failure_message, storage_busy_message};

    fn temporary_root() -> PathBuf {
        std::env::temp_dir().join(format!("musetric-app-storage-lock-{}", process::id()))
    }

    fn remove_temporary_root(root: &Path) -> io::Result<()> {
        match remove_dir_all(root) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        }
    }

    #[test]
    fn storage_lock_excludes_another_process() -> io::Result<()> {
        let root = temporary_root();
        remove_temporary_root(&root)?;
        let lock = acquire_storage_lock(&root)?
            .ok_or_else(|| io::Error::other("the first lock acquisition was unexpectedly busy"))?;
        assert!(acquire_storage_lock(&root)?.is_none());
        drop(lock);
        let replacement = acquire_storage_lock(&root)?
            .ok_or_else(|| io::Error::other("the released lock remained busy"))?;
        drop(replacement);
        remove_temporary_root(&root)
    }

    #[test]
    fn storage_busy_names_the_other_process() {
        let (title, message) = storage_busy_message();
        assert_eq!(title, "Musetric is already running");
        assert!(message.contains("same data folder"));
    }

    #[test]
    fn generic_startup_failure_points_at_the_log() {
        let error = io::Error::other("the port is in use");
        let logs = PathBuf::from("logs").join("musetric.log");
        let (title, message) = startup_failure_message(&error, &logs);
        assert_eq!(title, "Musetric could not start");
        assert!(message.contains("the port is in use"));
        assert!(message.contains(&logs.display().to_string()));
    }

    #[test]
    fn migration_failure_restores_into_the_database_directory() {
        let database_directory = PathBuf::from("storage").join("db");
        let backups_directory = database_directory.join("backups");
        let backup = backups_directory.join("app-v1.db");
        let logs = log_path(Path::new("data"));
        let failure =
            MigrationFailure::new("the schema could not be updated").backed_up(Some(&backup));
        let (title, message) = startup_failure_message(&failure, &logs);
        assert_eq!(title, "Musetric could not update its database");
        assert!(message.contains("the schema could not be updated"));
        assert!(message.contains(&backup.display().to_string()));
        assert!(message.contains(&format!(
            "delete app.db, app.db-wal and app.db-shm in {},",
            database_directory.display()
        )));
        assert!(!message.contains(&format!(
            "delete app.db, app.db-wal and app.db-shm in {},",
            backups_directory.display()
        )));
        assert!(message.contains(&logs.display().to_string()));
    }
}
