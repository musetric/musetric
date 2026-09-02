use std::{
    fs::{create_dir_all, remove_file},
    path::{Path, PathBuf},
};

use rusqlite::Connection;
use time::{OffsetDateTime, format_description::FormatItem, macros::format_description};

use crate::{
    database::{open_readonly, read_schema_version},
    failure::BoxedError,
};

const STAMP: &[FormatItem<'_>] =
    format_description!("[year]-[month]-[day]T[hour]-[minute]-[second]-[subsecond digits:3]Z");

pub fn create_backup_name(version: usize, at: OffsetDateTime) -> Result<String, time::Error> {
    let stamp = at.format(STAMP)?;
    Ok(format!("app-{stamp}-v{version}.db"))
}

fn assert_backup_version(path: &Path, expected: usize) -> Result<(), BoxedError> {
    let version = read_schema_version(&open_readonly(path)?)?;
    if version == expected {
        return Ok(());
    }
    Err(format!("backup has schema v{version} instead of v{expected}").into())
}

fn write_backup(connection: &Connection, path: &Path, version: usize) -> Result<(), BoxedError> {
    connection.execute("VACUUM INTO ?1", [path.to_string_lossy()])?;
    assert_backup_version(path, version)
}

pub(crate) fn create_backup(
    connection: &Connection,
    database_path: &Path,
    version: usize,
) -> Result<PathBuf, BoxedError> {
    let directory = database_path
        .parent()
        .ok_or("the database path has no parent directory")?
        .join("backups");
    create_dir_all(&directory)?;
    let path = directory.join(create_backup_name(version, OffsetDateTime::now_utc())?);
    if let Err(error) = write_backup(connection, &path, version) {
        let _ = remove_file(&path);
        return Err(error);
    }
    Ok(path)
}
