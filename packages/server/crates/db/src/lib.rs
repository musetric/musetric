mod analysis;
mod audio;
mod backup;
mod blob;
mod database;
mod failure;
mod preview;
mod processing;
mod project;
mod reader;
mod runner;
mod schema;
mod writer;

#[cfg(test)]
mod tests;

pub use analysis::{Analysis, AudioAnalysis};
pub use audio::{AudioDelivery, MasterType, Recording, StemType};
pub use backup::create_backup_name;
pub use blob::blob_path;
pub use database::{OpenOptions, open_database, open_readonly, read_schema_version};
pub use failure::{BoxedError, MigrationFailure};
pub use preview::Preview;
pub use processing::{PROCESSING_STEPS, PendingJob, ProcessingStep, StepFailure, StepResults};
pub use project::ProjectItem;
pub use reader::Reader;
pub use runner::{MigrationReport, init_database, run_migrations};
pub use schema::{MIGRATIONS, Migration};
pub use writer::{
    NewAudioAnalysis, NewPreview, NewProject, NewRecording, NewSeparation, ProjectEdit, StemBlobs,
    Writer,
};
