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
    pub(crate) prefix_frames: u32,
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
            prefix_frames: cursor.prefix_frames,
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

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use musetric_db::ProcessingStep;

    use super::{CheckpointCursor, persist_tail};
    use crate::{checkpoint::CheckpointDir, storage::Storage, test_workspace::Workspace};

    async fn checkpoint(
        storage: &Arc<Storage>,
        store: &CheckpointDir,
        next_unit: u32,
        tail: &[u8],
    ) {
        let cursor = CheckpointCursor {
            project_id: 1,
            step: ProcessingStep::Separation,
            attempt_id: "attempt",
            computation_id: "computation",
            pass: "vocals",
            next_unit,
            unit_count: 4,
            prefix_frames: next_unit * 10,
        };
        persist_tail(storage, store, tail.to_vec(), cursor)
            .await
            .expect("the checkpoint should commit");
    }

    #[tokio::test]
    async fn commits_the_cursor_with_the_tail_of_its_generation() {
        let workspace = Workspace::new();
        workspace.seed(
            "INSERT INTO Project (id, name, sampleRate, frameCount)
             VALUES (1, 'Fixture project', 48000, 480000);
             INSERT INTO ProcessingStep (projectId, step, status, attemptId)
             VALUES (1, 'separation', 'processing', 'attempt');",
        );
        let storage = workspace.create_storage();
        let store = CheckpointDir::create(workspace.work_path().join("checkpoint"));
        checkpoint(&storage, &store, 1, b"first").await;
        checkpoint(&storage, &store, 2, b"second").await;

        let cursor = storage
            .database
            .step_checkpoint(1, ProcessingStep::Separation)
            .expect("the checkpoint should be readable")
            .expect("the checkpoint should be stored");
        let tail = store
            .read_tail(cursor.generation)
            .await
            .expect("the tail should load");

        assert_eq!(cursor.generation, 2);
        assert_eq!(cursor.next_unit, 2);
        assert_eq!(cursor.prefix_frames, 20);
        assert_eq!(tail.bytes, b"second");
        assert_eq!(cursor.tail_hash.as_deref(), Some(tail.digest.as_str()));
        assert!(store.read_tail(1).await.is_err());
    }
}
