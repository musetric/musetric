use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, SystemTime},
};

use musetric_db::BoxedError;
use tokio::{
    fs::{read_dir, remove_file},
    time::sleep,
};

use crate::{
    failure::Failure,
    publish::hold_publications,
    storage::{Storage, read},
};

const COLLECT_INTERVAL: Duration = Duration::from_mins(5);
const BLOB_RETENTION: Duration = Duration::from_mins(5);

pub(crate) fn spawn_collector(storage: Arc<Storage>) {
    tokio::spawn(async move {
        loop {
            sleep(COLLECT_INTERVAL).await;
            let _ = collect(&storage, BLOB_RETENTION).await;
        }
    });
}

pub(crate) async fn collect(storage: &Arc<Storage>, retention: Duration) -> Result<(), Failure> {
    let candidates = read_candidates(&storage.blobs_path, retention).await?;
    if candidates.is_empty() {
        return Ok(());
    }
    let _held = hold_publications(storage).await;
    remove_unreferenced(storage, candidates).await
}

async fn remove_unreferenced(
    storage: &Arc<Storage>,
    candidates: Vec<StoredBlob>,
) -> Result<(), Failure> {
    let referenced = read(storage, musetric_db::Reader::referenced_blob_ids).await?;
    let known: HashSet<String> = referenced.into_iter().collect();
    for blob in candidates {
        if known.contains(&blob.blob_id) {
            continue;
        }
        let _ = remove_file(&blob.path).await;
    }
    Ok(())
}

async fn read_candidates(
    blobs_path: &Path,
    retention: Duration,
) -> Result<Vec<StoredBlob>, Failure> {
    let stored = list_blobs(blobs_path).await.map_err(Failure::failed)?;
    let mut candidates = Vec::new();
    for blob in stored {
        if has_exceeded_retention(&blob.path, retention).await {
            candidates.push(blob);
        }
    }
    Ok(candidates)
}

struct StoredBlob {
    blob_id: String,
    path: PathBuf,
}

async fn list_blobs(blobs_path: &Path) -> Result<Vec<StoredBlob>, BoxedError> {
    let mut stored = Vec::new();
    for level1 in list_directories(blobs_path).await? {
        for level2 in list_directories(&level1).await? {
            collect_files(&level2, &mut stored).await?;
        }
    }
    Ok(stored)
}

async fn list_directories(path: &Path) -> Result<Vec<PathBuf>, BoxedError> {
    let Ok(mut entries) = read_dir(path).await else {
        return Ok(Vec::new());
    };
    let mut directories = Vec::new();
    while let Some(entry) = entries.next_entry().await? {
        if entry.file_type().await?.is_dir() {
            directories.push(entry.path());
        }
    }
    Ok(directories)
}

async fn collect_files(path: &Path, stored: &mut Vec<StoredBlob>) -> Result<(), BoxedError> {
    let mut entries = read_dir(path).await?;
    while let Some(entry) = entries.next_entry().await? {
        if !entry.file_type().await?.is_file() {
            continue;
        }
        stored.push(StoredBlob {
            blob_id: entry.file_name().to_string_lossy().into_owned(),
            path: entry.path(),
        });
    }
    Ok(())
}

async fn has_exceeded_retention(path: &Path, retention: Duration) -> bool {
    let Ok(metadata) = tokio::fs::metadata(path).await else {
        return false;
    };
    let Ok(modified) = metadata.modified() else {
        return false;
    };
    SystemTime::now()
        .duration_since(modified)
        .is_ok_and(|elapsed| elapsed >= retention)
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{collect, read_candidates, remove_unreferenced};
    use crate::test_workspace::Workspace;

    const KEPT_BLOB_ID: &str = "1f2e3d4c-0000-4000-8000-000000000001";
    const STALE_BLOB_ID: &str = "5a6b7c8d-0000-4000-8000-000000000002";
    const FRESH_BLOB_ID: &str = "9c8b7a6d-0000-4000-8000-000000000003";
    const RETENTION: Duration = Duration::from_mins(5);
    const OLD: Duration = Duration::from_mins(30);
    const FRESH: Duration = Duration::from_secs(1);
    const BLOB: &str = "fixture blob";
    const CREATE_SOURCE: &str = "
      INSERT INTO Project (id, name, sampleRate, frameCount)
      VALUES (1, 'Fixture project', 48000, 480000);
      INSERT INTO AudioMaster (projectId, type, blobId)
      VALUES (1, 'source', '1f2e3d4c-0000-4000-8000-000000000001');
    ";

    const PUBLISHED_BLOB_ID: &str = "3d4e5f60-0000-4000-8000-000000000004";
    const REFERENCE_PUBLISHED: &str = "
      INSERT INTO AudioMaster (projectId, type, blobId)
      VALUES (1, 'instrumental', '3d4e5f60-0000-4000-8000-000000000004');
    ";

    #[tokio::test]
    async fn keeps_a_blob_referenced_after_the_candidates_were_listed() {
        let workspace = Workspace::new();
        workspace.seed(CREATE_SOURCE);
        workspace.add_blob(PUBLISHED_BLOB_ID, BLOB);
        workspace.age_blob(PUBLISHED_BLOB_ID, OLD);
        let storage = workspace.create_storage();
        let candidates = read_candidates(&storage.blobs_path, RETENTION)
            .await
            .expect("the candidates should be listed");
        assert_eq!(candidates.len(), 1);

        workspace.seed(REFERENCE_PUBLISHED);
        remove_unreferenced(&storage, candidates)
            .await
            .expect("the collection should finish");

        assert!(workspace.has_blob(PUBLISHED_BLOB_ID));
    }

    #[tokio::test]
    async fn removes_only_the_stale_unreferenced_blobs() {
        let workspace = Workspace::new();
        workspace.seed(CREATE_SOURCE);
        for blob_id in [KEPT_BLOB_ID, STALE_BLOB_ID, FRESH_BLOB_ID] {
            workspace.add_blob(blob_id, BLOB);
        }
        workspace.age_blob(KEPT_BLOB_ID, OLD);
        workspace.age_blob(STALE_BLOB_ID, OLD);
        workspace.age_blob(FRESH_BLOB_ID, FRESH);

        collect(&workspace.create_storage(), RETENTION)
            .await
            .expect("the collection should finish");

        assert!(workspace.has_blob(KEPT_BLOB_ID));
        assert!(workspace.has_blob(FRESH_BLOB_ID));
        assert!(!workspace.has_blob(STALE_BLOB_ID));
    }
}
