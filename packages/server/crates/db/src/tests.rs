use std::{
    fs::{copy, create_dir_all, read_dir, remove_dir_all, write},
    path::{Path, PathBuf},
};

use crate::{
    MIGRATIONS, Migration, MigrationFailure, MigrationReport, OpenOptions, create_backup_name,
    init_database, open_database, open_readonly, read_schema_version, run_migrations,
};
use rusqlite::Connection;
use time::macros::datetime;

const SCHEMA_QUERY: &str = "
  SELECT type, name, sql FROM sqlite_schema
  WHERE name NOT LIKE 'sqlite_%'
  ORDER BY type, name
";

const EXPECTED_FINGERPRINT: &str = include_str!("../../../../backend-db/schema.fingerprint.json");

const SECOND_STEP: Migration = &["ALTER TABLE Project ADD COLUMN note TEXT"];

const FAILING_SECOND_STEP: Migration = &[
    "ALTER TABLE Project ADD COLUMN note TEXT",
    "ALTER TABLE Missing ADD COLUMN note TEXT",
];

const FAILING_THIRD_STEP: Migration = &[
    "ALTER TABLE Project ADD COLUMN laterNote TEXT",
    "ALTER TABLE Missing ADD COLUMN note TEXT",
];

const DANGLING_STEP: Migration =
    &["INSERT INTO AudioMaster (projectId, type, blobId) VALUES (404, 'lead', 'orphan')"];

struct Workspace {
    directory: PathBuf,
}

impl Workspace {
    fn new() -> Self {
        let directory = std::env::temp_dir().join(format!(
            "musetric-db-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        create_dir_all(&directory).unwrap();
        Self { directory }
    }

    fn database_path(&self) -> PathBuf {
        self.directory.join("db").join("app.db")
    }

    fn backups(&self) -> Vec<String> {
        let directory = self.directory.join("db").join("backups");
        if !directory.exists() {
            return Vec::new();
        }
        read_dir(directory)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect()
    }
}

impl Drop for Workspace {
    fn drop(&mut self) {
        let _ = remove_dir_all(&self.directory);
    }
}

fn with_steps(extra: &[Migration]) -> Vec<Migration> {
    MIGRATIONS
        .iter()
        .copied()
        .chain(extra.iter().copied())
        .collect()
}

fn migrate(
    workspace: &Workspace,
    steps: &[Migration],
) -> Result<MigrationReport, MigrationFailure> {
    run_migrations(&workspace.database_path(), steps)
}

fn failure(workspace: &Workspace, steps: &[Migration]) -> MigrationFailure {
    migrate(workspace, steps).expect_err("the migration was expected to fail")
}

fn read<T>(path: &Path, read: impl FnOnce(&Connection) -> T) -> T {
    read(&open_readonly(path).unwrap())
}

fn user_version(path: &Path) -> usize {
    read(path, |connection| read_schema_version(connection).unwrap())
}

fn journal_mode(path: &Path) -> String {
    read(path, |connection| {
        connection
            .query_row("PRAGMA journal_mode", [], |row| row.get::<_, String>(0))
            .unwrap()
    })
}

fn project_columns(path: &Path) -> Vec<String> {
    read(path, |connection| {
        let mut statement = connection.prepare("PRAGMA table_info(Project)").unwrap();

        statement
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    })
}

fn normalize(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn fingerprint(path: &Path) -> Vec<String> {
    read(path, |connection| {
        let mut statement = connection.prepare(SCHEMA_QUERY).unwrap();

        statement
            .query_map([], |row| {
                let kind: String = row.get(0)?;
                let name: String = row.get(1)?;
                let sql: String = row.get(2)?;
                Ok(format!(
                    "{} {} {}",
                    normalize(&kind),
                    normalize(&name),
                    normalize(&sql)
                ))
            })
            .unwrap()
            .map(Result::unwrap)
            .collect()
    })
}

#[test]
fn creates_a_fresh_database_with_the_expected_physical_schema() {
    let workspace = Workspace::new();
    let path = workspace.database_path();

    let report = init_database(&path).unwrap();

    assert_eq!(report.from_version, 0);
    assert_eq!(report.to_version, MIGRATIONS.len());
    assert_eq!(report.backup_path, None);
    assert_eq!(user_version(&path), MIGRATIONS.len());
    assert_eq!(journal_mode(&path), "wal");
    assert!(workspace.backups().is_empty());

    let expected: Vec<String> = serde_json::from_str(EXPECTED_FINGERPRINT).unwrap();
    assert_eq!(fingerprint(&path), expected);
}

#[test]
fn does_nothing_on_a_database_that_is_already_up_to_date() {
    let workspace = Workspace::new();
    migrate(&workspace, MIGRATIONS).unwrap();

    let report = migrate(&workspace, MIGRATIONS).unwrap();

    assert_eq!(report.from_version, MIGRATIONS.len());
    assert_eq!(report.to_version, MIGRATIONS.len());
    assert!(workspace.backups().is_empty());
}

#[test]
fn refuses_a_database_newer_than_the_catalog_without_touching_it() {
    let workspace = Workspace::new();
    migrate(&workspace, &with_steps(&[SECOND_STEP])).unwrap();

    let failed = failure(&workspace, MIGRATIONS);

    assert_eq!(failed.backup_path(), None);
    assert_eq!(user_version(&workspace.database_path()), 2);
    assert!(workspace.backups().is_empty());
}

#[test]
fn reports_a_damaged_file_without_attempting_a_backup() {
    let workspace = Workspace::new();
    let path = workspace.database_path();
    create_dir_all(path.parent().unwrap()).unwrap();
    write(&path, "this is not a database").unwrap();

    let failed = failure(&workspace, MIGRATIONS);

    assert_eq!(failed.backup_path(), None);
    assert_eq!(failed.committed_version(), None);
}

#[test]
fn rolls_a_failing_step_back_and_keeps_the_previous_version() {
    let workspace = Workspace::new();
    let path = workspace.database_path();
    migrate(&workspace, MIGRATIONS).unwrap();

    let failed = failure(&workspace, &with_steps(&[FAILING_SECOND_STEP]));

    assert_eq!(failed.committed_version(), Some(1));
    assert_eq!(user_version(&path), 1);
    assert!(!project_columns(&path).contains(&"note".to_owned()));
    assert!(failed.backup_path().unwrap().exists());
}

#[test]
fn keeps_a_committed_earlier_step_when_a_later_step_fails() {
    let workspace = Workspace::new();
    let path = workspace.database_path();
    migrate(&workspace, MIGRATIONS).unwrap();

    let failed = failure(&workspace, &with_steps(&[SECOND_STEP, FAILING_THIRD_STEP]));

    assert_eq!(failed.committed_version(), Some(2));
    assert_eq!(user_version(&path), 2);

    let columns = project_columns(&path);
    assert!(columns.contains(&"note".to_owned()));
    assert!(!columns.contains(&"laterNote".to_owned()));
}

#[test]
fn leaves_a_restored_backup_in_wal_mode_once_it_is_opened_again() {
    let workspace = Workspace::new();
    let path = workspace.database_path();
    migrate(&workspace, MIGRATIONS).unwrap();
    let report = migrate(&workspace, &with_steps(&[SECOND_STEP])).unwrap();
    let backup_path = report.backup_path.unwrap();

    assert_eq!(journal_mode(&backup_path), "delete");

    copy(&backup_path, &path).unwrap();
    drop(open_database(&path, &OpenOptions { foreign_keys: true }).unwrap());

    assert_eq!(journal_mode(&path), "wal");
}

#[test]
fn rejects_a_step_that_leaves_a_dangling_foreign_key() {
    let workspace = Workspace::new();
    let path = workspace.database_path();
    migrate(&workspace, MIGRATIONS).unwrap();

    failure(&workspace, &with_steps(&[DANGLING_STEP]));

    assert_eq!(user_version(&path), 1);
    let orphan: Option<i64> = read(&path, |connection| {
        connection
            .query_row(
                "SELECT id FROM AudioMaster WHERE blobId = 'orphan'",
                [],
                |row| row.get(0),
            )
            .ok()
    });
    assert_eq!(orphan, None);
}

#[test]
fn avoids_characters_that_no_windows_file_name_may_hold() {
    let name = create_backup_name(3, datetime!(2026-08-08 09:14:16.123 UTC)).unwrap();

    assert_eq!(name, "app-2026-08-08T09-14-16-123Z-v3.db");
    assert!(!name.contains([':', '*', '?', '"', '<', '>', '|']));
}
