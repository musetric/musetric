use std::{
    fs::{create_dir_all, remove_dir_all},
    path::{Path, PathBuf},
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
use tokio::time::sleep;

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
        self.create_queue_with_idle(runner, Duration::from_mins(1))
    }

    fn create_queue_with_idle(&self, runner: Arc<dyn StepRunner>, idle: Duration) -> Arc<Queue> {
        Queue::create(QueueOptions {
            reader: Arc::new(Reader::open(&self.database_path()).expect("the reader should open")),
            writer: Arc::new(Writer::open(&self.database_path()).expect("the writer should open")),
            runner,
            interval: Duration::from_mins(1),
            idle_limit: idle,
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
    Stuck,
    Exploded,
    Lively,
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

    async fn wait_seen(&self, expected: usize) {
        for _ in 0..200 {
            if self.seen().len() >= expected {
                return;
            }
            sleep(Duration::from_millis(5)).await;
        }
    }
}

impl StepRunner for FakeRunner {
    fn run<'a>(&'a self, job: &'a PendingJob, report: &'a StepReport) -> StepOutcome<'a> {
        self.seen
            .lock()
            .expect("the log should be writable")
            .push(job.step.name());
        match self.answer {
            Answer::Stuck => return Box::pin(std::future::pending()),
            Answer::Exploded if self.seen().len() == 1 => {
                return Box::pin(async {
                    report(StepEvent::Progress(0.5));
                    panic!("the decoder exploded");
                });
            }
            Answer::Lively => {
                let database_path = self.database_path.clone();
                let step = job.step;
                return Box::pin(lively(database_path, step, report));
            }
            _ => {}
        }
        Box::pin(async move {
            report(StepEvent::Progress(0.5));
            match self.answer {
                Answer::Failed(failure) => return StepAnswer::Failed(failure.to_owned()),
                Answer::Gone => return StepAnswer::Unavailable,
                Answer::Silent => return StepAnswer::Finished,
                Answer::Complete | Answer::Stuck | Answer::Exploded | Answer::Lively => {}
            }
            Self::write_result(&self.database_path, job.step);
            StepAnswer::Finished
        })
    }
}

impl FakeRunner {
    fn write_result(database_path: &Path, step: ProcessingStep) {
        let options = OpenOptions {
            foreign_keys: false,
        };
        open_database(database_path, &options)
            .expect("the database should open")
            .execute_batch(result_statements(step))
            .expect("the result should be written");
    }
}

async fn lively(database_path: PathBuf, step: ProcessingStep, report: &StepReport) -> StepAnswer {
    for portion in [0.25, 0.5, 0.75] {
        sleep(Duration::from_millis(10)).await;
        report(StepEvent::Progress(portion));
    }
    FakeRunner::write_result(&database_path, step);
    StepAnswer::Finished
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

#[tokio::test]
async fn records_a_panicking_step_and_keeps_the_queue_alive() {
    let workspace = Workspace::new();
    workspace.execute(
        "INSERT INTO AudioMaster (projectId, type, blobId)
         VALUES (1, 'lead', 'lead-blob'), (1, 'instrumental', 'instrumental-blob');",
    );
    let runner = FakeRunner::create(&workspace, Answer::Exploded);
    let queue = workspace.create_queue(runner.clone());

    queue.drain().await;

    assert_eq!(
        runner.seen(),
        vec!["transcription", "rhythm", "key", "chords"]
    );
    let processing = queue
        .processing(1)
        .await
        .expect("the summary should be built");
    let transcription = processing.step(ProcessingStep::Transcription);
    assert_eq!(transcription.status, StepStatus::Failed);
    assert_eq!(
        transcription.error.as_deref().map(str::to_owned),
        Some("The step panicked: the decoder exploded".to_owned())
    );
    assert_eq!(
        processing.step(ProcessingStep::Rhythm).status,
        StepStatus::Done
    );
}

#[tokio::test]
async fn fails_a_step_that_stops_making_progress() {
    let workspace = Workspace::new();
    let runner = FakeRunner::create(&workspace, Answer::Stuck);
    let queue = workspace.create_queue_with_idle(runner.clone(), Duration::from_millis(50));

    queue.drain().await;

    assert_eq!(runner.seen(), vec!["separation"]);
    let processing = queue
        .processing(1)
        .await
        .expect("the summary should be built");
    let separation = processing.step(ProcessingStep::Separation);
    assert_eq!(separation.status, StepStatus::Failed);
    assert!(
        separation
            .error
            .as_deref()
            .is_some_and(|error| error.contains("no progress"))
    );
}

#[tokio::test]
async fn keeps_a_reporting_step_clear_of_the_idle_watchdog() {
    let workspace = Workspace::new();
    let runner = FakeRunner::create(&workspace, Answer::Lively);
    let queue = workspace.create_queue_with_idle(runner.clone(), Duration::from_millis(50));

    queue.drain().await;

    let processing = queue
        .processing(1)
        .await
        .expect("the summary should be built");
    assert_eq!(
        processing.step(ProcessingStep::Separation).status,
        StepStatus::Done
    );
}

#[tokio::test]
async fn cancels_the_running_step_when_its_project_is_removed() {
    let workspace = Workspace::new();
    let runner = FakeRunner::create(&workspace, Answer::Stuck);
    let queue = workspace.create_queue_with_idle(runner.clone(), Duration::from_mins(1));

    let worker = tokio::spawn({
        let running = Arc::clone(&queue);
        async move { running.drain().await }
    });
    runner.wait_seen(1).await;
    queue.cancel_project(1);
    worker
        .await
        .expect("the drain should finish after the cancel");

    assert_eq!(runner.seen(), vec!["separation"]);
    let processing = queue
        .processing(1)
        .await
        .expect("the summary should be built");
    let separation = processing.step(ProcessingStep::Separation);
    assert_eq!(separation.status, StepStatus::Pending);
    assert_eq!(separation.error, None);
}
