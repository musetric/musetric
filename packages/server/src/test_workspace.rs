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

use musetric_db::{
    OpenOptions as DatabaseOptions, Reader, Writer, blob_path, init_database, open_database,
};
use musetric_media::Tools;

use crate::storage::Storage;

static WORKSPACE_COUNT: AtomicUsize = AtomicUsize::new(0);

pub(crate) struct Workspace {
    directory: PathBuf,
}

impl Workspace {
    pub(crate) fn new() -> Self {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("the clock should be after the epoch")
            .as_nanos();
        let ordinal = WORKSPACE_COUNT.fetch_add(1, Ordering::Relaxed);
        let directory =
            std::env::temp_dir().join(format!("musetric-test-{}-{stamp}-{ordinal}", id()));
        create_dir_all(&directory).expect("the workspace should be created");
        let workspace = Self { directory };
        init_database(&workspace.database_path()).expect("the database should be created");
        workspace
    }

    pub(crate) fn database_path(&self) -> PathBuf {
        self.directory.join("db").join("app.db")
    }

    pub(crate) fn blobs_path(&self) -> PathBuf {
        self.directory.join("blobs")
    }

    pub(crate) fn seed(&self, statements: &str) {
        let options = DatabaseOptions {
            foreign_keys: false,
        };
        open_database(&self.database_path(), &options)
            .expect("the database should open")
            .execute_batch(statements)
            .expect("the fixture should be written");
    }

    pub(crate) fn add_blob(&self, blob_id: &str, content: &str) {
        let path = blob_path(&self.blobs_path(), blob_id);
        let directory = path.parent().expect("a blob path should have a directory");
        create_dir_all(directory).expect("the blob directory should be created");
        write(&path, content).expect("the blob should be written");
    }

    pub(crate) fn age_blob(&self, blob_id: &str, age: Duration) {
        OpenOptions::new()
            .write(true)
            .open(blob_path(&self.blobs_path(), blob_id))
            .expect("the blob should reopen")
            .set_modified(SystemTime::now() - age)
            .expect("the blob time should be set");
    }

    pub(crate) fn has_blob(&self, blob_id: &str) -> bool {
        blob_path(&self.blobs_path(), blob_id).exists()
    }

    pub(crate) fn create_storage(&self) -> Arc<Storage> {
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
