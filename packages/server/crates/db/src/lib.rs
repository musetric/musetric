mod backup;
mod database;
mod failure;
mod runner;
mod schema;

#[cfg(test)]
mod tests;

pub use backup::create_backup_name;
pub use database::{OpenOptions, open_database, open_readonly, read_schema_version};
pub use failure::{BoxedError, MigrationFailure};
pub use runner::{MigrationReport, init_database, run_migrations};
pub use schema::{MIGRATIONS, Migration};
