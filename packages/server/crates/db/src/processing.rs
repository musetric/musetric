use rusqlite::{Connection, OptionalExtension, Result, Transaction};

use crate::audio::MasterType;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProcessingStep {
    Separation,
    Voices,
    Transcription,
    Rhythm,
    Key,
    Chords,
}

pub const PROCESSING_STEPS: [ProcessingStep; 6] = [
    ProcessingStep::Separation,
    ProcessingStep::Voices,
    ProcessingStep::Transcription,
    ProcessingStep::Rhythm,
    ProcessingStep::Key,
    ProcessingStep::Chords,
];

impl ProcessingStep {
    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "separation" => Some(Self::Separation),
            "voices" => Some(Self::Voices),
            "transcription" => Some(Self::Transcription),
            "rhythm" => Some(Self::Rhythm),
            "key" => Some(Self::Key),
            "chords" => Some(Self::Chords),
            _ => None,
        }
    }

    #[must_use]
    pub fn name(self) -> &'static str {
        match self {
            Self::Separation => "separation",
            Self::Voices => "voices",
            Self::Transcription => "transcription",
            Self::Rhythm => "rhythm",
            Self::Key => "key",
            Self::Chords => "chords",
        }
    }

    #[must_use]
    pub fn source(self) -> MasterType {
        match self {
            Self::Separation => MasterType::Source,
            Self::Voices => MasterType::Vocals,
            Self::Transcription => MasterType::Lead,
            Self::Rhythm | Self::Key | Self::Chords => MasterType::Instrumental,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StepStatus {
    Pending,
    Processing,
    Done,
    Failed,
}

impl StepStatus {
    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "pending" => Some(Self::Pending),
            "processing" => Some(Self::Processing),
            "done" => Some(Self::Done),
            "failed" => Some(Self::Failed),
            _ => None,
        }
    }

    #[must_use]
    pub fn name(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Processing => "processing",
            Self::Done => "done",
            Self::Failed => "failed",
        }
    }
}

pub struct StepState {
    pub step: ProcessingStep,
    pub status: StepStatus,
    pub error: Option<String>,
}

pub struct PendingJob {
    pub step: ProcessingStep,
    pub project_id: i64,
    pub blob_id: String,
}

pub struct StepUpdate {
    pub project_id: i64,
    pub step: ProcessingStep,
    pub status: StepStatus,
    pub error: Option<String>,
    pub required: StepStatus,
    pub attempt_id: Option<String>,
}

pub struct StepCheckpoint {
    pub attempt_id: Option<String>,
    pub computation_id: Option<String>,
    pub generation: u32,
    pub pass: Option<String>,
    pub next_unit: u32,
    pub unit_count: u32,
    pub prefix_frames: u32,
    pub tail_hash: Option<String>,
    pub tail_bytes: i64,
}

pub struct CheckpointWrite {
    pub project_id: i64,
    pub step: ProcessingStep,
    pub attempt_id: String,
    pub computation_id: String,
    pub generation: u32,
    pub pass: String,
    pub next_unit: u32,
    pub unit_count: u32,
    pub prefix_frames: u32,
    pub tail_hash: String,
    pub tail_bytes: i64,
}

pub(crate) fn create_steps(transaction: &Transaction, project_id: i64) -> Result<()> {
    for step in PROCESSING_STEPS {
        transaction.execute(
            "INSERT INTO ProcessingStep (projectId, step, status) VALUES (?1, ?2, ?3)",
            (project_id, step.name(), StepStatus::Pending.name()),
        )?;
    }
    Ok(())
}

pub(crate) fn read_pending(
    connection: &Connection,
    step: ProcessingStep,
) -> Result<Option<PendingJob>> {
    connection
        .query_row(
            "SELECT Step.projectId, Master.blobId
             FROM ProcessingStep AS Step
             JOIN AudioMaster AS Master
               ON Master.projectId = Step.projectId AND Master.type = ?2
             WHERE Step.step = ?1 AND Step.status = ?3
             ORDER BY Step.projectId
             LIMIT 1",
            (
                step.name(),
                step.source().name(),
                StepStatus::Pending.name(),
            ),
            |row| {
                Ok(PendingJob {
                    step,
                    project_id: row.get(0)?,
                    blob_id: row.get(1)?,
                })
            },
        )
        .optional()
}

pub(crate) fn read_states(connection: &Connection, project_id: i64) -> Result<Vec<StepState>> {
    let mut statement = connection
        .prepare("SELECT step, status, error FROM ProcessingStep WHERE projectId = ?1")?;
    let rows = statement.query_map([project_id], |row| {
        let name: String = row.get(0)?;
        let recorded: String = row.get(1)?;
        let error: Option<String> = row.get(2)?;
        Ok((name, recorded, error))
    })?;
    let mut found = Vec::new();
    for row in rows {
        let (name, recorded, error) = row?;
        if let Some(step) = ProcessingStep::parse(&name)
            && let Some(status) = StepStatus::parse(&recorded)
        {
            found.push(StepState {
                step,
                status,
                error,
            });
        }
    }
    Ok(found)
}

pub(crate) fn write_status(transaction: &Transaction, update: &StepUpdate) -> Result<usize> {
    transaction.execute(
        "UPDATE ProcessingStep
         SET status = ?3, error = ?4, attemptId = ?5
         WHERE projectId = ?1 AND step = ?2 AND status = ?6",
        (
            update.project_id,
            update.step.name(),
            update.status.name(),
            update.error.as_deref(),
            update.attempt_id.as_deref(),
            update.required.name(),
        ),
    )
}

pub(crate) fn read_checkpoint(
    connection: &Connection,
    project_id: i64,
    step: ProcessingStep,
) -> Result<Option<StepCheckpoint>> {
    connection
        .query_row(
            "SELECT attemptId, computationId, checkpointGeneration, pass, nextUnit,
                    unitCount, prefixFrames, tailHash, tailBytes
             FROM ProcessingStep WHERE projectId = ?1 AND step = ?2",
            (project_id, step.name()),
            |row| {
                Ok(StepCheckpoint {
                    attempt_id: row.get(0)?,
                    computation_id: row.get(1)?,
                    generation: row.get(2)?,
                    pass: row.get(3)?,
                    next_unit: row.get(4)?,
                    unit_count: row.get(5)?,
                    prefix_frames: row.get(6)?,
                    tail_hash: row.get(7)?,
                    tail_bytes: row.get(8)?,
                })
            },
        )
        .optional()
}

pub(crate) fn bind_attempt(
    transaction: &Transaction,
    project_id: i64,
    step: ProcessingStep,
    attempt_id: &str,
) -> Result<usize> {
    transaction.execute(
        "UPDATE ProcessingStep SET attemptId = ?3
         WHERE projectId = ?1 AND step = ?2 AND status = ?4",
        (
            project_id,
            step.name(),
            attempt_id,
            StepStatus::Processing.name(),
        ),
    )
}

pub(crate) fn write_checkpoint(
    transaction: &Transaction,
    write: &CheckpointWrite,
) -> Result<usize> {
    transaction.execute(
        "UPDATE ProcessingStep
         SET computationId = ?3, checkpointGeneration = ?4, pass = ?5, nextUnit = ?6,
             unitCount = ?7, prefixFrames = ?8, tailHash = ?9, tailBytes = ?10
         WHERE projectId = ?1 AND step = ?2 AND status = ?11 AND attemptId = ?12",
        (
            write.project_id,
            write.step.name(),
            write.computation_id.as_str(),
            write.generation,
            write.pass.as_str(),
            write.next_unit,
            write.unit_count,
            write.prefix_frames,
            write.tail_hash.as_str(),
            write.tail_bytes,
            StepStatus::Processing.name(),
            write.attempt_id.as_str(),
        ),
    )
}

pub(crate) fn abandon_running(transaction: &Transaction) -> Result<usize> {
    transaction.execute(
        "UPDATE ProcessingStep SET status = ?1, attemptId = NULL WHERE status = ?2",
        (StepStatus::Pending.name(), StepStatus::Processing.name()),
    )
}
