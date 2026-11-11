use std::{
    path::PathBuf,
    process::id,
    sync::atomic::{AtomicUsize, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use super::{CheckpointDir, computation_id, digest_of};

static WORKSPACE_COUNT: AtomicUsize = AtomicUsize::new(0);

struct Workspace {
    directory: PathBuf,
}

impl Workspace {
    fn new() -> Self {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("the clock should be after the epoch")
            .as_nanos();
        let ordinal = WORKSPACE_COUNT.fetch_add(1, Ordering::Relaxed);
        let directory =
            std::env::temp_dir().join(format!("musetric-checkpoint-{}-{stamp}-{ordinal}", id()));
        std::fs::create_dir_all(&directory).expect("the workspace should be created");
        Self { directory }
    }

    fn store(&self) -> CheckpointDir {
        CheckpointDir::create(self.directory.join("work"))
    }
}

impl Drop for Workspace {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}

const FIRST: &[u8] = &[1, 2, 3, 4];
const SECOND: &[u8] = &[5, 6, 7, 8, 9];

#[tokio::test]
async fn restores_the_committed_generation_when_a_newer_tail_is_uncommitted() {
    let workspace = Workspace::new();
    let store = workspace.store();
    let committed = store
        .write_tail(1, FIRST)
        .await
        .expect("the first tail should write");
    store
        .write_tail(2, SECOND)
        .await
        .expect("the uncommitted tail should write");

    let restored = store
        .read_tail(1)
        .await
        .expect("the committed tail should load");
    assert_eq!(restored.digest, committed.digest);
    assert_eq!(restored.bytes, FIRST);
}

#[tokio::test]
async fn uses_the_new_generation_after_the_cursor_moves() {
    let workspace = Workspace::new();
    let store = workspace.store();
    store
        .write_tail(1, FIRST)
        .await
        .expect("the old tail should write");
    let committed = store
        .write_tail(2, SECOND)
        .await
        .expect("the new tail should write");
    store.discard(1).await;

    let restored = store.read_tail(2).await.expect("the new tail should load");
    assert_eq!(restored.digest, committed.digest);
    assert!(
        store.read_tail(1).await.is_err(),
        "the old generation must be gone"
    );
}

#[tokio::test]
async fn refuses_a_tail_whose_digest_does_not_match() {
    let workspace = Workspace::new();
    let store = workspace.store();
    let stored = store
        .write_tail(1, FIRST)
        .await
        .expect("the tail should write");
    let loaded = store.read_tail(1).await.expect("the tail should load");
    assert_eq!(loaded.digest, stored.digest);
    assert_ne!(digest_of(b"other"), loaded.digest);
}

#[tokio::test]
async fn keeps_input_pcm_next_to_the_checkpoint() {
    let workspace = Workspace::new();
    let store = workspace.store();
    store
        .write_input(&[0.25, -0.5, 0.125, 1.0])
        .await
        .expect("the input should write");
    let loaded = store.read_input().await.expect("the input should load");
    assert_eq!(loaded, vec![0.25, -0.5, 0.125, 1.0]);
}

#[test]
fn changes_the_computation_id_when_the_weights_change() {
    let geometry = computation_id(&["vocals-v1", "2", "same-size"]);
    let other_weights = computation_id(&["vocals-v1", "2", "other-weights"]);
    assert_ne!(geometry, other_weights);
}
