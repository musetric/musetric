use std::{fs::create_dir_all, path::Path, sync::Mutex, time::Duration};

use rusqlite::{Connection, ErrorCode};

use crate::BoxedError;

const LOCK_NAME: &str = "backend.lock";

pub struct StorageLock {
    _connection: Mutex<Connection>,
}

pub fn lock_storage(database: &Path) -> Result<Option<StorageLock>, BoxedError> {
    let directory = database
        .parent()
        .ok_or("The database path has no directory")?;
    create_dir_all(directory)?;
    let connection = Connection::open(directory.join(LOCK_NAME))?;
    connection.busy_timeout(Duration::ZERO)?;
    match connection.execute_batch("BEGIN EXCLUSIVE") {
        Ok(()) => Ok(Some(StorageLock {
            _connection: Mutex::new(connection),
        })),
        Err(error) if is_busy(&error) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn is_busy(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(failure, _) if failure.code == ErrorCode::DatabaseBusy
    )
}

#[cfg(test)]
mod tests {
    use std::{fs::remove_dir_all, process::id};

    use super::lock_storage;

    #[test]
    fn keeps_a_second_owner_out_until_the_first_lets_go() {
        let root = std::env::temp_dir().join(format!("musetric-storage-lock-{}", id()));
        let database = root.join("db").join("app.db");
        let first = lock_storage(&database)
            .expect("the lock should open")
            .expect("the first owner should get the lock");

        let second = lock_storage(&database).expect("the lock should open");
        drop(first);
        let replacement = lock_storage(&database).expect("the lock should open");
        drop(replacement);
        remove_dir_all(&root).expect("the workspace should be removed");

        assert!(second.is_none());
    }
}
