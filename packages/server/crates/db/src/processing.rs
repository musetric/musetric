use rusqlite::{Connection, OptionalExtension, Result, Transaction};

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

    fn source(self) -> &'static str {
        match self {
            Self::Separation => "source",
            Self::Transcription => "lead",
            Self::Rhythm | Self::Key | Self::Chords => "instrumental",
        }
    }

    fn produced(self, project: &str) -> String {
        match self {
            Self::Separation => format!(
                "SELECT 1 FROM AudioMaster AS Produced
                 WHERE Produced.projectId = {project} AND Produced.type = 'lead'"
            ),
            Self::Transcription => {
                format!("SELECT 1 FROM Subtitle WHERE Subtitle.projectId = {project}")
            }
            Self::Rhythm => format!("SELECT 1 FROM Rhythm WHERE Rhythm.projectId = {project}"),
            Self::Key => format!("SELECT 1 FROM Key WHERE Key.projectId = {project}"),
            Self::Chords => format!("SELECT 1 FROM Chords WHERE Chords.projectId = {project}"),
        }
    }
}

pub struct PendingJob {
    pub step: ProcessingStep,
    pub project_id: i64,
    pub blob_id: String,
}

pub struct StepFailure {
    pub step: ProcessingStep,
    pub message: String,
}

pub struct StepResults {
    completed: Vec<ProcessingStep>,
}

impl StepResults {
    #[must_use]
    pub fn has(&self, step: ProcessingStep) -> bool {
        self.completed.contains(&step)
    }
}

pub(crate) fn read_pending(
    connection: &Connection,
    step: ProcessingStep,
) -> Result<Option<PendingJob>> {
    let produced = step.produced("Master.projectId");
    let query = format!(
        "SELECT Master.projectId, Master.blobId
         FROM AudioMaster AS Master
         WHERE Master.type = ?1
           AND NOT EXISTS ({produced})
           AND NOT EXISTS (
             SELECT 1 FROM ProcessingError
             WHERE ProcessingError.projectId = Master.projectId
               AND ProcessingError.step = ?2
           )"
    );
    connection
        .query_row(&query, (step.source(), step.name()), |row| {
            Ok(PendingJob {
                step,
                project_id: row.get(0)?,
                blob_id: row.get(1)?,
            })
        })
        .optional()
}

pub(crate) fn read_failures(connection: &Connection, project_id: i64) -> Result<Vec<StepFailure>> {
    let mut statement =
        connection.prepare("SELECT step, message FROM ProcessingError WHERE projectId = ?1")?;
    let rows = statement.query_map([project_id], |row| {
        let name: String = row.get(0)?;
        let message: String = row.get(1)?;
        Ok((name, message))
    })?;
    let mut failures = Vec::new();
    for row in rows {
        let (name, message) = row?;
        if let Some(step) = ProcessingStep::parse(&name) {
            failures.push(StepFailure { step, message });
        }
    }
    Ok(failures)
}

pub(crate) fn read_results(connection: &Connection, project_id: i64) -> Result<StepResults> {
    let mut completed = Vec::new();
    for step in PROCESSING_STEPS {
        let produced = step.produced("?1");
        let found: bool = connection.query_row(
            &format!("SELECT EXISTS ({produced})"),
            [project_id],
            |row| row.get(0),
        )?;
        if found {
            completed.push(step);
        }
    }
    Ok(StepResults { completed })
}

pub(crate) fn write_failure(
    transaction: &Transaction,
    project_id: i64,
    step: ProcessingStep,
    message: &str,
) -> Result<usize> {
    transaction.execute(
        "INSERT INTO ProcessingError (projectId, step, message)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(projectId, step) DO UPDATE SET message = excluded.message",
        (project_id, step.name(), message),
    )
}

pub(crate) fn clear_failure(
    transaction: &Transaction,
    project_id: i64,
    step: ProcessingStep,
) -> Result<usize> {
    transaction.execute(
        "DELETE FROM ProcessingError WHERE projectId = ?1 AND step = ?2",
        (project_id, step.name()),
    )
}
