use std::{path::Path, sync::Mutex};

use rusqlite::Connection;

use crate::{
    analysis::{Analysis, AudioAnalysis, read_analysis_blob, read_audio_analysis},
    audio::{
        AudioDelivery, MasterType, Recording, StemType, read_delivery, read_master_blob,
        read_recording,
    },
    blob::read_referenced_blob_ids,
    database::{OpenOptions, open_database},
    failure::BoxedError,
    preview::{Preview, read_preview},
    processing::{
        PendingJob, ProcessingStep, StepFailure, StepResults, read_failures, read_pending,
        read_results,
    },
    project::{ProjectItem, read_project, read_project_name, read_projects},
};

pub struct Reader {
    connection: Mutex<Connection>,
}

impl Reader {
    pub fn open(database_path: &Path) -> Result<Self, BoxedError> {
        let connection = open_database(
            database_path,
            &OpenOptions {
                foreign_keys: false,
            },
        )?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn analysis_blob(
        &self,
        analysis: Analysis,
        project_id: i64,
    ) -> Result<Option<String>, BoxedError> {
        self.read(|connection| read_analysis_blob(connection, analysis, project_id))
    }

    pub fn project_name(&self, project_id: i64) -> Result<Option<String>, BoxedError> {
        self.read(|connection| read_project_name(connection, project_id))
    }

    pub fn project(&self, project_id: i64) -> Result<Option<ProjectItem>, BoxedError> {
        self.read(|connection| read_project(connection, project_id))
    }

    pub fn projects(&self) -> Result<Vec<ProjectItem>, BoxedError> {
        self.read(read_projects)
    }

    pub fn audio_analysis(&self, project_id: i64) -> Result<Option<AudioAnalysis>, BoxedError> {
        self.read(|connection| read_audio_analysis(connection, project_id))
    }

    pub fn step_results(&self, project_id: i64) -> Result<StepResults, BoxedError> {
        self.read(|connection| read_results(connection, project_id))
    }

    pub fn step_failures(&self, project_id: i64) -> Result<Vec<StepFailure>, BoxedError> {
        self.read(|connection| read_failures(connection, project_id))
    }

    pub fn pending_job(&self, step: ProcessingStep) -> Result<Option<PendingJob>, BoxedError> {
        self.read(|connection| read_pending(connection, step))
    }

    pub fn master_blob(
        &self,
        project_id: i64,
        master: MasterType,
    ) -> Result<Option<String>, BoxedError> {
        self.read(|connection| read_master_blob(connection, project_id, master))
    }

    pub fn delivery(
        &self,
        project_id: i64,
        stem: StemType,
    ) -> Result<Option<AudioDelivery>, BoxedError> {
        self.read(|connection| read_delivery(connection, project_id, stem))
    }

    pub fn recording(&self, project_id: i64) -> Result<Option<Recording>, BoxedError> {
        self.read(|connection| read_recording(connection, project_id))
    }

    pub fn preview(&self, preview_id: i64) -> Result<Option<Preview>, BoxedError> {
        self.read(|connection| read_preview(connection, preview_id))
    }

    pub fn referenced_blob_ids(&self) -> Result<Vec<String>, BoxedError> {
        self.read(read_referenced_blob_ids)
    }

    fn read<Value>(
        &self,
        query: impl FnOnce(&Connection) -> Result<Value, rusqlite::Error>,
    ) -> Result<Value, BoxedError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "the database connection is no longer usable")?;
        Ok(query(&connection)?)
    }
}
