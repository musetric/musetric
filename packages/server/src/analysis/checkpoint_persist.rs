use std::sync::Arc;

use musetric_db::{CheckpointWrite, ProcessingStep};

use crate::{
    analysis::browser::Failure,
    checkpoint::CheckpointDir,
    storage::{Storage, read_database, write_database},
};

const NOT_ACTIVE: &str = "the attempt is not active";

pub(crate) struct PrefixAppend {
    pub(crate) committed_bytes: u64,
    pub(crate) bytes: Vec<u8>,
    pub(crate) frames: u32,
}

pub(crate) struct CheckpointCursor<'cursor> {
    pub(crate) project_id: i64,
    pub(crate) step: ProcessingStep,
    pub(crate) attempt_id: &'cursor str,
    pub(crate) computation_id: &'cursor str,
    pub(crate) pass: &'cursor str,
    pub(crate) next_unit: u32,
    pub(crate) unit_count: u32,
    pub(crate) prefix: Option<PrefixAppend>,
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
    let prefix_frames = match cursor.prefix {
        Some(append) => {
            checkpoint
                .append_prefix(append.committed_bytes, &append.bytes)
                .await
                .map_err(|error| Failure::from(error.to_string()))?;
            append.frames
        }
        None => 0,
    };
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
            prefix_frames,
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

    use super::{CheckpointCursor, PrefixAppend, persist_tail};
    use crate::{
        checkpoint::CheckpointDir,
        storage::Storage,
        test_workspace::Workspace,
        unit_fold::FoldAccumulator,
        unit_plan::{PlanRules, PlanUnit, UnitPlan},
    };

    const FRAMES: u64 = 10;

    async fn checkpoint(
        storage: &Arc<Storage>,
        store: &CheckpointDir,
        (fold, plan, next): (&FoldAccumulator, &UnitPlan, u32),
        committed: u64,
    ) -> u64 {
        let settled = plan.settled_frames(next as usize, FRAMES);
        let reached = plan.reached_frames(next as usize, FRAMES).max(settled);
        let prefix = PrefixAppend {
            committed_bytes: committed * fold.record_bytes() as u64,
            bytes: fold.records(committed, settled),
            frames: u32::try_from(settled).expect("the prefix fits"),
        };
        let cursor = CheckpointCursor {
            project_id: 1,
            step: ProcessingStep::Separation,
            attempt_id: "attempt",
            computation_id: "computation",
            pass: "separate",
            next_unit: next,
            unit_count: 4,
            prefix: Some(prefix),
        };
        persist_tail(storage, store, fold.records(settled, reached), cursor)
            .await
            .expect("the checkpoint should commit");
        settled
    }

    #[tokio::test]
    async fn restores_a_fold_from_its_committed_prefix_and_tail() {
        let workspace = Workspace::new();
        workspace.seed(
            "INSERT INTO Project (id, name, sampleRate, frameCount)
             VALUES (1, 'Fixture project', 48000, 480000);
             INSERT INTO ProcessingStep (projectId, step, status, attemptId)
             VALUES (1, 'separation', 'processing', 'attempt');",
        );
        let storage = workspace.create_storage();
        let store = CheckpointDir::create(workspace.work_path().join("checkpoint"));
        let plan = UnitPlan::create(
            PlanRules::LeadBackingV1,
            2,
            4,
            [0, 2, 4, 6]
                .into_iter()
                .map(|start| PlanUnit { start, length: 4 })
                .collect(),
        );
        let chunk: Vec<f32> = (0..8_u16).map(|value| f32::from(value + 1)).collect();
        let mut fold = FoldAccumulator::create(FRAMES, 2);
        fold.add(&plan, 0, &chunk);
        fold.add(&plan, 1, &chunk);
        let committed = checkpoint(&storage, &store, (&fold, &plan, 2), 0).await;
        fold.add(&plan, 2, &chunk);
        fold.add(&plan, 3, &chunk);
        checkpoint(&storage, &store, (&fold, &plan, 4), committed).await;

        let cursor = storage
            .database
            .step_checkpoint(1, ProcessingStep::Separation)
            .expect("the checkpoint should be readable")
            .expect("the checkpoint should be stored");
        let prefix = store
            .read_prefix(u64::from(cursor.prefix_frames) * fold.record_bytes() as u64)
            .await
            .expect("the prefix should load");
        let tail = store
            .read_tail(cursor.generation)
            .await
            .expect("the tail should load");
        let restored = FoldAccumulator::restore(FRAMES, 2, &prefix, &tail.bytes)
            .expect("the checkpoint should restore");

        assert_eq!(u64::from(cursor.prefix_frames), FRAMES);
        assert_eq!(cursor.tail_hash.as_deref(), Some(tail.digest.as_str()));
        assert_eq!(restored.finalize(), fold.finalize());
    }
}
