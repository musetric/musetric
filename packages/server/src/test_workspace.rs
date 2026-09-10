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

use crate::{
    page_bridge::PageBridge, publish::Publication, realtime::Rooms, routes::RouteState,
    storage::Storage,
};
use axum::http::StatusCode;
use musetric_db::{
    OpenOptions as DatabaseOptions, PendingJob, Reader, Writer, blob_path, init_database,
    open_database,
};
use musetric_gpu::{Bundle, ExecutorHost, ExecutorHostOptions, PhaseSink, UnitSession};
use musetric_jobs::{Queue, QueueOptions, StepAnswer, StepOutcome, StepReport, StepRunner};
use musetric_media::SymphoniaPcm;

const QUEUE_INTERVAL: Duration = Duration::from_mins(1);

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

    pub(crate) fn work_path(&self) -> PathBuf {
        self.directory.join("work")
    }

    pub(crate) fn unit_incoming_path(&self) -> PathBuf {
        self.work_path().join("incoming")
    }

    fn unit_bundle_path(&self) -> PathBuf {
        let bundle = self.work_path().join("unit-bundle");
        create_dir_all(&bundle).expect("the unit bundle should be created");
        write(bundle.join("index.js"), "fixture;").expect("the unit bundle should be written");
        bundle
    }

    pub(crate) async fn start_unit_host(
        &self,
        label: &str,
        units: Arc<dyn UnitSession>,
    ) -> ExecutorHost {
        let sink: PhaseSink = Arc::new(|_| {});
        ExecutorHost::start(ExecutorHostOptions {
            label: label.to_owned(),
            bundle: Bundle::Directory(self.unit_bundle_path()),
            pcm: Vec::new().into(),
            require_shader_f16: false,
            on_phase: sink,
            units: Some(units),
        })
        .await
        .expect("the unit host should start")
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
            database: Arc::new(
                Reader::open(&self.database_path()).expect("the reader should open"),
            ),
            writer: Arc::new(Writer::open(&self.database_path()).expect("the writer should open")),
            blobs_path: self.blobs_path(),
            work_path: self.work_path(),
            pcm: Arc::new(SymphoniaPcm),
            publication: Publication::default(),
        })
    }
}

pub(crate) async fn get_unit_window(base: &str, attempt: &str, unit: u32) -> (StatusCode, Vec<u8>) {
    let response = reqwest::Client::new()
        .get(format!("{base}/attempt/{attempt}/unit/{unit}"))
        .send()
        .await
        .expect("the unit window should answer");
    let status = response.status();
    (
        status,
        response
            .bytes()
            .await
            .expect("the unit window body")
            .to_vec(),
    )
}

struct IdleRunner;

impl StepRunner for IdleRunner {
    fn run<'a>(&'a self, _job: &'a PendingJob, _report: &'a StepReport) -> StepOutcome<'a> {
        Box::pin(async { StepAnswer::Unavailable })
    }
}

pub(crate) fn create_route_state(storage: Arc<Storage>) -> RouteState {
    let queue = Queue::create(QueueOptions {
        reader: Arc::clone(&storage.database),
        writer: Arc::clone(&storage.writer),
        runner: Arc::new(IdleRunner),
        interval: QUEUE_INTERVAL,
        idle_limit: QUEUE_INTERVAL,
    });
    RouteState {
        rooms: Arc::new(Rooms::create()),
        storage,
        queue,
        pages: PageBridge::create(),
    }
}

impl Drop for Workspace {
    fn drop(&mut self) {
        let _ = remove_dir_all(&self.directory);
    }
}
