use std::{
    fs::{create_dir_all, remove_dir_all},
    path::PathBuf,
    process::id,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use musetric_db::{
    OpenOptions, PendingJob, ProcessingStep, Reader, Writer, init_database, open_database,
};

use crate::{
    queue::{
        Queue, QueueOptions, StatusEvent, StepAnswer, StepEvent, StepOutcome, StepReport,
        StepRunner,
    },
    summary::StepStatus,
};

static WORKSPACE_COUNT: AtomicUsize = AtomicUsize::new(0);

const SEED: &str = "
  INSERT INTO Project (id, name, sampleRate, frameCount)
  VALUES (1, 'Fixture project', 48000, 480000);
  INSERT INTO AudioMaster (projectId, type, blobId) VALUES (1, 'source', 'source-blob');
";

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
            std::env::temp_dir().join(format!("musetric-jobs-{}-{stamp}-{ordinal}", id()));
        create_dir_all(&directory).expect("the workspace should be created");
        let workspace = Self { directory };
        init_database(&workspace.database_path()).expect("the database should be created");
        workspace.execute(SEED);
        workspace
    }

    fn database_path(&self) -> PathBuf {
        self.directory.join("db").join("app.db")
    }

    fn execute(&self, statements: &str) {
        let options = OpenOptions {
            foreign_keys: false,
        };
        open_database(&self.database_path(), &options)
            .expect("the database should open")
            .execute_batch(statements)
            .expect("the statements should run");
    }

    fn create_queue(&self, runner: Arc<dyn StepRunner>) -> Arc<Queue> {
        Queue::create(QueueOptions {
            reader: Arc::new(Reader::open(&self.database_path()).expect("the reader should open")),
            writer: Arc::new(Writer::open(&self.database_path()).expect("the writer should open")),
            runner,
            interval: Duration::from_mins(1),
        })
    }
}

impl Drop for Workspace {
    fn drop(&mut self) {
        let _ = remove_dir_all(&self.directory);
    }
}

fn result_statements(step: ProcessingStep) -> &'static str {
    match step {
        ProcessingStep::Separation => {
            "INSERT INTO AudioMaster (projectId, type, blobId)
             VALUES (1, 'lead', 'lead-blob'), (1, 'backing', 'backing-blob'),
                    (1, 'instrumental', 'instrumental-blob');"
        }
        ProcessingStep::Transcription => {
            "INSERT INTO Subtitle (projectId, blobId) VALUES (1, 'subtitle-blob');"
        }
        ProcessingStep::Rhythm => {
            "INSERT INTO Rhythm (projectId, blobId) VALUES (1, 'rhythm-blob');"
        }
        ProcessingStep::Key => "INSERT INTO Key (projectId, blobId) VALUES (1, 'key-blob');",
        ProcessingStep::Chords => {
            "INSERT INTO Chords (projectId, blobId) VALUES (1, 'chords-blob');"
        }
    }
}

enum Answer {
    Complete,
    Silent,
    Gone,
    Failed(&'static str),
}

struct FakeRunner {
    database_path: PathBuf,
    answer: Answer,
    seen: Mutex<Vec<&'static str>>,
}

impl FakeRunner {
    fn create(workspace: &Workspace, answer: Answer) -> Arc<Self> {
        Arc::new(Self {
            database_path: workspace.database_path(),
            answer,
            seen: Mutex::new(Vec::new()),
        })
    }

    fn seen(&self) -> Vec<&'static str> {
        self.seen
            .lock()
            .expect("the log should be readable")
            .clone()
    }
}

impl StepRunner for FakeRunner {
    fn run<'a>(&'a self, job: &'a PendingJob, report: &'a StepReport) -> StepOutcome<'a> {
        Box::pin(async move {
            self.seen
                .lock()
                .expect("the log should be writable")
                .push(job.step.name());
            report(StepEvent::Progress(0.5));
            match self.answer {
                Answer::Failed(failure) => return StepAnswer::Failed(failure.to_owned()),
                Answer::Gone => return StepAnswer::Unavailable,
                Answer::Silent => return StepAnswer::Finished,
                Answer::Complete => {}
            }
            let options = OpenOptions {
                foreign_keys: false,
            };
            open_database(&self.database_path, &options)
                .expect("the database should open")
                .execute_batch(result_statements(job.step))
                .expect("the result should be written");
            StepAnswer::Finished
        })
    }
}

fn collect_events(events: &mut tokio::sync::broadcast::Receiver<StatusEvent>) -> Vec<StatusEvent> {
    let mut collected = Vec::new();
    while let Ok(event) = events.try_recv() {
        collected.push(event);
    }
    collected
}

#[tokio::test]
async fn runs_every_pending_step_once() {
    let workspace = Workspace::new();
    let runner = FakeRunner::create(&workspace, Answer::Complete);
    let queue = workspace.create_queue(runner.clone());

    queue.drain().await;

    assert_eq!(
        runner.seen(),
        vec!["separation", "transcription", "rhythm", "key", "chords"]
    );
    let processing = queue
        .processing(1)
        .await
        .expect("the summary should be built");
    assert!(processing.done);
}

#[tokio::test]
async fn records_a_failed_step_and_stops_repeating_it() {
    let workspace = Workspace::new();
    let runner = FakeRunner::create(&workspace, Answer::Failed("Separation failed"));
    let queue = workspace.create_queue(runner.clone());

    queue.drain().await;

    assert_eq!(runner.seen(), vec!["separation"]);
    let processing = queue
        .processing(1)
        .await
        .expect("the summary should be built");
    let separation = processing.step(ProcessingStep::Separation);
    assert_eq!(separation.status, StepStatus::Failed);
    assert_eq!(separation.error.as_deref(), Some("Separation failed"));
    assert!(!processing.done);
}

#[tokio::test]
async fn publishes_the_progress_of_a_running_step() {
    let workspace = Workspace::new();
    let runner = FakeRunner::create(&workspace, Answer::Failed("Separation failed"));
    let queue = workspace.create_queue(runner);
    let mut events = queue.subscribe();

    queue.drain().await;

    let collected = collect_events(&mut events);
    let running = collected
        .iter()
        .filter_map(|event| {
            let step = event.processing.step(ProcessingStep::Separation);
            (step.status == StepStatus::Processing).then_some(step.progress)
        })
        .collect::<Vec<_>>();
    assert_eq!(running, vec![Some(0.0), Some(0.5)]);
    let last = collected.last().expect("an event should be published");
    assert_eq!(
        last.processing.step(ProcessingStep::Separation).status,
        StepStatus::Failed
    );
}

#[tokio::test]
async fn leaves_a_step_that_produced_nothing_to_the_next_round() {
    let workspace = Workspace::new();
    let runner = FakeRunner::create(&workspace, Answer::Silent);
    let queue = workspace.create_queue(runner.clone());

    queue.drain().await;

    assert_eq!(runner.seen(), vec!["separation"]);
    let processing = queue
        .processing(1)
        .await
        .expect("the summary should be built");
    assert_eq!(
        processing.step(ProcessingStep::Separation).status,
        StepStatus::Pending
    );
}

#[tokio::test]
async fn keeps_a_step_pending_when_the_executor_is_gone() {
    let workspace = Workspace::new();
    let runner = FakeRunner::create(&workspace, Answer::Gone);
    let queue = workspace.create_queue(runner.clone());

    queue.drain().await;

    let processing = queue
        .processing(1)
        .await
        .expect("the summary should be built");
    let separation = processing.step(ProcessingStep::Separation);
    assert_eq!(runner.seen(), vec!["separation"]);
    assert_eq!(separation.status, StepStatus::Pending);
    assert_eq!(separation.error, None);
}
