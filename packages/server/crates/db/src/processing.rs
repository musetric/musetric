use rusqlite::{Connection, OptionalExtension, Result, Transaction};

use crate::audio::MasterType;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProcessingStep {
    Separation,
    Transcription,
    Rhythm,
    Key,
    Chords,
}

pub const PROCESSING_STEPS: [ProcessingStep; 5] = [
    ProcessingStep::Separation,
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
        "UPDATE ProcessingStep SET status = ?3, error = ?4 WHERE projectId = ?1 AND step = ?2",
        (
            update.project_id,
            update.step.name(),
            update.status.name(),
            update.error.as_deref(),
        ),
    )
}

pub(crate) fn abandon_running(transaction: &Transaction) -> Result<usize> {
    transaction.execute(
        "UPDATE ProcessingStep SET status = ?1 WHERE status = ?2",
        (StepStatus::Pending.name(), StepStatus::Processing.name()),
    )
}
