mod analysis;
mod backup;
mod blob;
mod database;
mod failure;
mod project;
mod reader;
mod runner;
mod schema;

#[cfg(test)]
mod tests;

pub use analysis::Analysis;
pub use backup::create_backup_name;
pub use blob::blob_path;
pub use database::{OpenOptions, open_database, open_readonly, read_schema_version};
pub use failure::{BoxedError, MigrationFailure};
pub use reader::Reader;
pub use runner::{MigrationReport, init_database, run_migrations};
pub use schema::{MIGRATIONS, Migration};
