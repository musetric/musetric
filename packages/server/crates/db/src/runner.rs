use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::{
    backup::create_backup,
    database::{
        OpenOptions, open_database, open_readonly, read_schema_version, write_schema_version,
    },
    failure::{BoxedError, MigrationFailure},
    schema::{MIGRATIONS, Migration},
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MigrationReport {
    pub from_version: usize,
    pub to_version: usize,
    pub backup_path: Option<PathBuf>,
}

fn probe_version(database_path: &Path) -> Result<usize, MigrationFailure> {
    if !database_path.exists() {
        return Ok(0);
    }
    open_readonly(database_path)
        .and_then(|connection| read_schema_version(&connection))
        .map_err(|cause| {
            MigrationFailure::new("The database file could not be read and may be damaged.")
                .caused_by(cause)
        })
}

fn take_backup(
    connection: &Connection,
    database_path: &Path,
    version: usize,
) -> Result<PathBuf, MigrationFailure> {
    create_backup(connection, database_path, version).map_err(|cause| {
        MigrationFailure::new("The database backup could not be created, so nothing was changed.")
            .caused_by(cause)
    })
}

fn run_statements(
    connection: &Connection,
    statements: Migration,
    version: usize,
) -> Result<(), BoxedError> {
    connection.execute_batch("BEGIN IMMEDIATE")?;
    for statement in statements {
        connection.execute_batch(statement)?;
    }
    let mut violations = connection.prepare("PRAGMA foreign_key_check")?;
    if violations.query([])?.next()?.is_some() {
        return Err("the migration left a dangling foreign key".into());
    }
    drop(violations);
    write_schema_version(connection, version)?;
    connection.execute_batch("COMMIT")?;
    Ok(())
}

fn apply_migration(
    connection: &Connection,
    statements: Migration,
    version: usize,
    backup_path: Option<&Path>,
) -> Result<(), MigrationFailure> {
    run_statements(connection, statements, version).map_err(|cause| {
        let _ = connection.execute_batch("ROLLBACK");
        let previous = version - 1;
        MigrationFailure::new(format!(
            "Migration v{version} did not finish. It was rolled back, so the database still holds schema v{previous}."
        ))
        .committed(previous)
        .backed_up(backup_path)
        .caused_by(cause)
    })
}

pub fn run_migrations(
    database_path: &Path,
    steps: &[Migration],
) -> Result<MigrationReport, MigrationFailure> {
    let latest = steps.len();
    let from_version = probe_version(database_path)?;
    if from_version > latest {
        return Err(MigrationFailure::new(format!(
            "The database holds schema v{from_version}, which this build does not know: it supports v{latest}. Install the newer version again, or restore an older copy of the database."
        )));
    }
    if from_version == latest {
        return Ok(MigrationReport {
            from_version,
            to_version: latest,
            backup_path: None,
        });
    }

    let connection = open_database(
        database_path,
        &OpenOptions {
            foreign_keys: false,
        },
    )
    .map_err(|cause| {
        MigrationFailure::new("The database could not be opened for migration.").caused_by(cause)
    })?;
    let backup_path = if from_version > 0 {
        Some(take_backup(&connection, database_path, from_version)?)
    } else {
        None
    };
    for version in (from_version + 1)..=latest {
        apply_migration(
            &connection,
            steps[version - 1],
            version,
            backup_path.as_deref(),
        )?;
    }
    Ok(MigrationReport {
        from_version,
        to_version: latest,
        backup_path,
    })
}

pub fn init_database(database_path: &Path) -> Result<MigrationReport, MigrationFailure> {
    run_migrations(database_path, MIGRATIONS)
}
