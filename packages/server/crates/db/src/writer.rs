use std::{path::Path, sync::Mutex};

use rusqlite::{Connection, OptionalExtension, Result, Transaction, TransactionBehavior};

use crate::{
    analysis::Analysis,
    database::{OpenOptions, open_database},
    failure::BoxedError,
    processing::{ProcessingStep, clear_failure, write_failure},
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

pub struct NewAudioAnalysis {
    pub source_integrated_loudness_db: f64,
    pub source_true_peak_db: f64,
    pub source_gain_db: f64,
    pub lead_integrated_loudness_db: f64,
    pub lead_true_peak_db: f64,
    pub lead_p95_rms_db: f64,
    pub lead_spectrogram_gain_db: f64,
    pub backing_integrated_loudness_db: f64,
    pub backing_true_peak_db: f64,
    pub instrumental_integrated_loudness_db: f64,
    pub instrumental_true_peak_db: f64,
    pub lead_gain_db: f64,
    pub backing_gain_db: f64,
    pub instrumental_gain_db: f64,
}

pub struct StemBlobs {
    pub lead: String,
    pub backing: String,
    pub instrumental: String,
}

pub struct NewSeparation {
    pub project_id: i64,
    pub analysis: NewAudioAnalysis,
    pub master: StemBlobs,
    pub delivery: StemBlobs,
    pub wave_peaks: StemBlobs,
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
            clear_failure(transaction, project_id, analysis.step())?;
            Ok(())
        })
    }

    pub fn apply_separation_result(&self, result: &NewSeparation) -> Result<(), BoxedError> {
        self.write(|transaction| {
            write_audio_analysis(transaction, result.project_id, &result.analysis)?;
            for (stem, blob_id) in stems(&result.master) {
                transaction.execute(
                    "INSERT INTO AudioMaster (projectId, type, blobId) VALUES (?1, ?2, ?3)
                     ON CONFLICT(projectId, type) DO UPDATE SET blobId = excluded.blobId",
                    (result.project_id, stem, blob_id),
                )?;
            }
            for ((stem, blob_id), (_, wave_blob_id)) in stems(&result.delivery)
                .into_iter()
                .zip(stems(&result.wave_peaks))
            {
                transaction.execute(
                    "INSERT INTO AudioDelivery (projectId, stemType, blobId, waveBlobId)
                     VALUES (?1, ?2, ?3, ?4)
                     ON CONFLICT(projectId, stemType) DO UPDATE SET
                       blobId = excluded.blobId,
                       waveBlobId = excluded.waveBlobId",
                    (result.project_id, stem, blob_id, wave_blob_id),
                )?;
            }
            clear_failure(transaction, result.project_id, ProcessingStep::Separation)?;
            Ok(())
        })
    }

    pub fn record_failure(
        &self,
        project_id: i64,
        step: ProcessingStep,
        message: &str,
    ) -> Result<(), BoxedError> {
        self.write(|transaction| {
            write_failure(transaction, project_id, step, message)?;
            Ok(())
        })
    }

    pub fn clear_failure(&self, project_id: i64, step: ProcessingStep) -> Result<bool, BoxedError> {
        self.write(|transaction| {
            let cleared = clear_failure(transaction, project_id, step)?;
            Ok(cleared != 0)
        })
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

fn stems(blobs: &StemBlobs) -> [(&'static str, &str); 3] {
    [
        ("lead", blobs.lead.as_str()),
        ("backing", blobs.backing.as_str()),
        ("instrumental", blobs.instrumental.as_str()),
    ]
}

fn write_audio_analysis(
    transaction: &Transaction,
    project_id: i64,
    analysis: &NewAudioAnalysis,
) -> Result<usize> {
    transaction.execute(
        "INSERT INTO ProjectAudioAnalysis (
           projectId, sourceIntegratedLoudnessDb, sourceTruePeakDb, sourceGainDb,
           leadIntegratedLoudnessDb, leadTruePeakDb, leadP95RmsDb, leadSpectrogramGainDb,
           backingIntegratedLoudnessDb, backingTruePeakDb,
           instrumentalIntegratedLoudnessDb, instrumentalTruePeakDb,
           leadGainDb, backingGainDb, instrumentalGainDb
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
         ON CONFLICT(projectId) DO UPDATE SET
           sourceIntegratedLoudnessDb = excluded.sourceIntegratedLoudnessDb,
           sourceTruePeakDb = excluded.sourceTruePeakDb,
           sourceGainDb = excluded.sourceGainDb,
           leadIntegratedLoudnessDb = excluded.leadIntegratedLoudnessDb,
           leadTruePeakDb = excluded.leadTruePeakDb,
           leadP95RmsDb = excluded.leadP95RmsDb,
           leadSpectrogramGainDb = excluded.leadSpectrogramGainDb,
           backingIntegratedLoudnessDb = excluded.backingIntegratedLoudnessDb,
           backingTruePeakDb = excluded.backingTruePeakDb,
           instrumentalIntegratedLoudnessDb = excluded.instrumentalIntegratedLoudnessDb,
           instrumentalTruePeakDb = excluded.instrumentalTruePeakDb,
           leadGainDb = excluded.leadGainDb,
           backingGainDb = excluded.backingGainDb,
           instrumentalGainDb = excluded.instrumentalGainDb",
        (
            project_id,
            analysis.source_integrated_loudness_db,
            analysis.source_true_peak_db,
            analysis.source_gain_db,
            analysis.lead_integrated_loudness_db,
            analysis.lead_true_peak_db,
            analysis.lead_p95_rms_db,
            analysis.lead_spectrogram_gain_db,
            analysis.backing_integrated_loudness_db,
            analysis.backing_true_peak_db,
            analysis.instrumental_integrated_loudness_db,
            analysis.instrumental_true_peak_db,
            analysis.lead_gain_db,
            analysis.backing_gain_db,
            analysis.instrumental_gain_db,
        ),
    )
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
