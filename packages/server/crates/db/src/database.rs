use std::{fs::create_dir_all, path::Path, time::Duration};

use rusqlite::{Connection, Error, OpenFlags, Result};

use crate::failure::BoxedError;

const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

pub struct OpenOptions {
    pub foreign_keys: bool,
}

pub fn open_database(
    database_path: &Path,
    options: &OpenOptions,
) -> Result<Connection, BoxedError> {
    if let Some(directory) = database_path.parent() {
        create_dir_all(directory)?;
    }
    let connection = Connection::open(database_path)?;
    connection.busy_timeout(BUSY_TIMEOUT)?;
    connection.pragma_update(None, "foreign_keys", options.foreign_keys)?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    Ok(connection)
}

pub fn open_readonly(database_path: &Path) -> Result<Connection> {
    Connection::open_with_flags(database_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
}

pub fn read_schema_version(connection: &Connection) -> Result<usize> {
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    usize::try_from(version).map_err(|_| Error::IntegralValueOutOfRange(0, version))
}

pub(crate) fn write_schema_version(connection: &Connection, version: usize) -> Result<()> {
    connection.execute_batch(&format!("PRAGMA user_version = {version}"))
}
