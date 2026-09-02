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
    let referenced = read(storage, musetric_db::Reader::referenced_blob_ids).await?;
    let known: HashSet<String> = referenced.into_iter().collect();
    let stored = list_blobs(&storage.blobs_path)
        .await
        .map_err(Failure::failed)?;
    for blob in stored {
        if known.contains(&blob.blob_id) {
            continue;
        }
        if has_exceeded_retention(&blob.path, retention).await {
            let _ = remove_file(&blob.path).await;
        }
    }
    Ok(())
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
    use std::{
        fs::{OpenOptions, create_dir_all, remove_dir_all, write},
        path::PathBuf,
        process::id,
        sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        },
        time::{Duration, SystemTime, UNIX_EPOCH},
    };

    use musetric_db::{Reader, Writer, blob_path, init_database, open_database};
    use musetric_media::Tools;

    use super::collect;
    use crate::storage::Storage;

    const KEPT_BLOB_ID: &str = "1f2e3d4c-0000-4000-8000-000000000001";
    const STALE_BLOB_ID: &str = "5a6b7c8d-0000-4000-8000-000000000002";
    const FRESH_BLOB_ID: &str = "9c8b7a6d-0000-4000-8000-000000000003";
    const RETENTION: Duration = Duration::from_mins(5);
    const CREATE_PROJECT: &str = "
      INSERT INTO Project (id, name, sampleRate, frameCount)
      VALUES (1, 'Fixture project', 48000, 480000);
      INSERT INTO AudioMaster (projectId, type, blobId)
      VALUES (1, 'source', '1f2e3d4c-0000-4000-8000-000000000001');
    ";

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
                std::env::temp_dir().join(format!("musetric-garbage-{}-{stamp}-{ordinal}", id()));
            create_dir_all(&directory).expect("the workspace should be created");
            let workspace = Self { directory };
            init_database(&workspace.database_path()).expect("the database should be created");
            let options = musetric_db::OpenOptions {
                foreign_keys: false,
            };
            open_database(&workspace.database_path(), &options)
                .expect("the database should open")
                .execute_batch(CREATE_PROJECT)
                .expect("the fixture should be written");
            workspace
        }

        fn database_path(&self) -> PathBuf {
            self.directory.join("db").join("app.db")
        }

        fn blobs_path(&self) -> PathBuf {
            self.directory.join("blobs")
        }

        fn add_blob(&self, blob_id: &str, age: Duration) {
            let path = blob_path(&self.blobs_path(), blob_id);
            let directory = path.parent().expect("a blob path should have a directory");
            create_dir_all(directory).expect("the blob directory should be created");
            write(&path, "fixture blob").expect("the blob should be written");
            OpenOptions::new()
                .write(true)
                .open(&path)
                .expect("the blob should reopen")
                .set_modified(SystemTime::now() - age)
                .expect("the blob time should be set");
        }

        fn exists(&self, blob_id: &str) -> bool {
            blob_path(&self.blobs_path(), blob_id).exists()
        }

        fn create_storage(&self) -> Arc<Storage> {
            Arc::new(Storage {
                database: Reader::open(&self.database_path()).expect("the reader should open"),
                writer: Writer::open(&self.database_path()).expect("the writer should open"),
                blobs_path: self.blobs_path(),
                tools: Tools {
                    ffmpeg: PathBuf::from("ffmpeg"),
                    ffprobe: PathBuf::from("ffprobe"),
                },
            })
        }
    }

    impl Drop for Workspace {
        fn drop(&mut self) {
            let _ = remove_dir_all(&self.directory);
        }
    }

    #[tokio::test]
    async fn removes_only_the_stale_unreferenced_blobs() {
        let workspace = Workspace::new();
        workspace.add_blob(KEPT_BLOB_ID, Duration::from_mins(30));
        workspace.add_blob(STALE_BLOB_ID, Duration::from_mins(30));
        workspace.add_blob(FRESH_BLOB_ID, Duration::from_secs(1));

        collect(&workspace.create_storage(), RETENTION)
            .await
            .expect("the collection should finish");

        assert!(workspace.exists(KEPT_BLOB_ID));
        assert!(workspace.exists(FRESH_BLOB_ID));
        assert!(!workspace.exists(STALE_BLOB_ID));
    }
}
