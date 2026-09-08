use std::{path::Path, sync::Mutex};

use rusqlite::{Connection, OptionalExtension, Result, Transaction, TransactionBehavior};

use crate::{
    analysis::{Analysis, StemLoudness, write_stem_loudness},
    audio::MasterType,
    database::{OpenOptions, open_database},
    failure::BoxedError,
    processing::{
        CheckpointWrite, ProcessingStep, StepUpdate, abandon_running, bind_attempt, create_steps,
        write_checkpoint, write_status,
    },
};

pub struct NewPreview {
    pub blob_id: String,
    pub filename: String,
    pub content_type: String,
}

pub struct NewProject {
    pub name: String,
    pub song_blob_id: String,
    pub sample_rate: i64,
    pub frame_count: i64,
    pub preview: Option<NewPreview>,
}

pub struct NewDelivery {
    pub blob_id: String,
    pub wave_blob_id: String,
}

pub struct NewStem {
    pub stem: MasterType,
    pub master_blob_id: String,
    pub delivery: Option<NewDelivery>,
}

pub struct NewStems {
    pub project_id: i64,
    pub loudness: Vec<StemLoudness>,
    pub stems: Vec<NewStem>,
}

pub struct NewRecording {
    pub project_id: i64,
    pub blob_id: String,
    pub wave_blob_id: String,
    pub sample_rate: i64,
    pub frame_count: i64,
}

pub struct ProjectEdit {
    pub project_id: i64,
    pub name: Option<String>,
    pub preview: Option<NewPreview>,
    pub without_preview: bool,
}

pub struct Writer {
    connection: Mutex<Connection>,
}

impl Writer {
    pub fn open(database_path: &Path) -> Result<Self, BoxedError> {
        let connection = open_database(database_path, &OpenOptions { foreign_keys: true })?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn create_project(&self, project: &NewProject) -> Result<i64, BoxedError> {
        self.write(|transaction| {
            transaction.execute(
                "INSERT INTO Project (name, sampleRate, frameCount) VALUES (?1, ?2, ?3)",
                (&project.name, project.sample_rate, project.frame_count),
            )?;
            let project_id = transaction.last_insert_rowid();
            transaction.execute(
                "INSERT INTO AudioMaster (projectId, type, blobId) VALUES (?1, 'source', ?2)",
                (project_id, &project.song_blob_id),
            )?;
            create_steps(transaction, project_id)?;
            if let Some(preview) = project.preview.as_ref() {
                insert_preview(transaction, project_id, preview)?;
            }
            Ok(project_id)
        })
    }

    pub fn edit_project(&self, edit: &ProjectEdit) -> Result<bool, BoxedError> {
        self.write(|transaction| {
            if !project_exists(transaction, edit.project_id)? {
                return Ok(false);
            }
            if let Some(name) = edit.name.as_ref() {
                transaction.execute(
                    "UPDATE Project SET name = ?1 WHERE id = ?2",
                    (name, edit.project_id),
                )?;
            }
            if edit.without_preview || edit.preview.is_some() {
                transaction.execute(
                    "DELETE FROM Preview WHERE projectId = ?1",
                    [edit.project_id],
                )?;
            }
            if !edit.without_preview
                && let Some(preview) = edit.preview.as_ref()
            {
                insert_preview(transaction, edit.project_id, preview)?;
            }
            Ok(true)
        })
    }

    pub fn create_recording(&self, recording: &NewRecording) -> Result<(), BoxedError> {
        self.write(|transaction| {
            transaction.execute(
                "INSERT INTO Recording (projectId, blobId, waveBlobId, sampleRate, frameCount)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                (
                    recording.project_id,
                    &recording.blob_id,
                    &recording.wave_blob_id,
                    recording.sample_rate,
                    recording.frame_count,
                ),
            )?;
            Ok(())
        })
    }

    pub fn remove_project(&self, project_id: i64) -> Result<bool, BoxedError> {
        self.write(|transaction| {
            let removed = transaction.execute("DELETE FROM Project WHERE id = ?1", [project_id])?;
            Ok(removed != 0)
        })
    }

    pub fn apply_analysis_result(
        &self,
        analysis: Analysis,
        project_id: i64,
        blob_id: &str,
    ) -> Result<(), BoxedError> {
        let table = analysis.table();
        self.write(|transaction| {
            transaction.execute(
                &format!(
                    "INSERT INTO {table} (projectId, blobId) VALUES (?1, ?2)
                     ON CONFLICT(projectId) DO UPDATE SET blobId = excluded.blobId"
                ),
                (project_id, blob_id),
            )?;
            Ok(())
        })
    }

    pub fn apply_stems_result(&self, result: &NewStems) -> Result<(), BoxedError> {
        self.write(|transaction| {
            for measured in &result.loudness {
                write_stem_loudness(transaction, result.project_id, measured)?;
            }
            for stem in &result.stems {
                write_stem(transaction, result.project_id, stem)?;
            }
            Ok(())
        })
    }

    pub fn set_step_status(&self, update: &StepUpdate) -> Result<bool, BoxedError> {
        self.write(|transaction| {
            let written = write_status(transaction, update)?;
            Ok(written != 0)
        })
    }

    pub fn bind_attempt(
        &self,
        project_id: i64,
        step: ProcessingStep,
        attempt_id: String,
    ) -> Result<bool, BoxedError> {
        self.write(move |transaction| {
            let written = bind_attempt(transaction, project_id, step, &attempt_id)?;
            Ok(written != 0)
        })
    }

    pub fn commit_checkpoint(&self, write: &CheckpointWrite) -> Result<bool, BoxedError> {
        self.write(|transaction| {
            let written = write_checkpoint(transaction, write)?;
            Ok(written != 0)
        })
    }

    pub fn abandon_running_steps(&self) -> Result<usize, BoxedError> {
        self.write(abandon_running)
    }

    fn write<Value>(
        &self,
        run: impl FnOnce(&Transaction) -> Result<Value>,
    ) -> Result<Value, BoxedError> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| "the database connection is no longer usable")?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let value = run(&transaction)?;
        transaction.commit()?;
        Ok(value)
    }
}

fn write_stem(transaction: &Transaction, project_id: i64, stem: &NewStem) -> Result<()> {
    transaction.execute(
        "INSERT INTO AudioMaster (projectId, type, blobId) VALUES (?1, ?2, ?3)
         ON CONFLICT(projectId, type) DO UPDATE SET blobId = excluded.blobId",
        (project_id, stem.stem.name(), &stem.master_blob_id),
    )?;
    let Some(delivery) = stem.delivery.as_ref() else {
        return Ok(());
    };
    transaction.execute(
        "INSERT INTO AudioDelivery (projectId, stemType, blobId, waveBlobId)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(projectId, stemType) DO UPDATE SET
           blobId = excluded.blobId,
           waveBlobId = excluded.waveBlobId",
        (
            project_id,
            stem.stem.name(),
            &delivery.blob_id,
            &delivery.wave_blob_id,
        ),
    )?;
    Ok(())
}

fn project_exists(transaction: &Transaction, project_id: i64) -> Result<bool> {
    let found = transaction
        .query_row("SELECT 1 FROM Project WHERE id = ?1", [project_id], |_| {
            Ok(())
        })
        .optional()?;
    Ok(found.is_some())
}

fn insert_preview(
    transaction: &Transaction,
    project_id: i64,
    preview: &NewPreview,
) -> Result<usize> {
    transaction.execute(
        "INSERT INTO Preview (projectId, blobId, filename, contentType) VALUES (?1, ?2, ?3, ?4)",
        (
            project_id,
            &preview.blob_id,
            &preview.filename,
            &preview.content_type,
        ),
    )
}
