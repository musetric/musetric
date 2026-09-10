use std::sync::Arc;

use musetric_db::{CheckpointWrite, ProcessingStep};

use crate::{
    analysis::browser::Failure,
    checkpoint::CheckpointDir,
    storage::{Storage, read_database, write_database},
};

const NOT_ACTIVE: &str = "the attempt is not active";

pub(crate) struct CheckpointCursor<'cursor> {
    pub(crate) project_id: i64,
    pub(crate) step: ProcessingStep,
    pub(crate) attempt_id: &'cursor str,
    pub(crate) computation_id: &'cursor str,
    pub(crate) pass: &'cursor str,
    pub(crate) next_unit: u32,
    pub(crate) unit_count: u32,
}

pub(crate) async fn persist_tail(
    storage: &Arc<Storage>,
    checkpoint: &CheckpointDir,
    bytes: Vec<u8>,
    cursor: CheckpointCursor<'_>,
) -> Result<(), Failure> {
    let previous = read_database(storage, {
        let project_id = cursor.project_id;
        let step = cursor.step;
        move |reader| reader.step_checkpoint(project_id, step)
    })
    .await?
    .map_or(0, |stored_checkpoint| stored_checkpoint.generation);
    let generation = previous + 1;
    let stored = checkpoint
        .write_tail(generation, &bytes)
        .await
        .map_err(|error| Failure::from(error.to_string()))?;
    let committed = write_database(storage, {
        let write = CheckpointWrite {
            project_id: cursor.project_id,
            step: cursor.step,
            attempt_id: cursor.attempt_id.to_owned(),
            computation_id: cursor.computation_id.to_owned(),
            generation,
            pass: cursor.pass.to_owned(),
            next_unit: cursor.next_unit,
            unit_count: cursor.unit_count,
            prefix_frames: 0,
            tail_hash: stored.digest,
            tail_bytes: i64::try_from(stored.bytes.len()).unwrap_or(0),
        };
        move |writer| writer.commit_checkpoint(&write)
    })
    .await?;
    if !committed {
        return Err(Failure::Refused(NOT_ACTIVE.to_owned()));
    }
    if previous > 0 {
        checkpoint.discard(previous).await;
    }
    Ok(())
}
