use std::{
    future::Future,
    panic::AssertUnwindSafe,
    pin::Pin,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use futures_util::FutureExt;
use musetric_db::{
    BoxedError, PendingJob, ProcessingStep, Reader, StepFailure, StepResults, Writer,
};
use serde_json::Value;
use tokio::{
    sync::{Notify, broadcast},
    task::spawn_blocking,
    time::sleep,
};

use crate::summary::{ActiveStep, Processing, build_processing};

const EVENT_CAPACITY: usize = 64;
const QUEUE_ORDER: [ProcessingStep; 5] = [
    ProcessingStep::Transcription,
    ProcessingStep::Rhythm,
    ProcessingStep::Key,
    ProcessingStep::Chords,
    ProcessingStep::Separation,
];

pub enum StepEvent {
    Progress(f64),
    Download(Value),
}

pub type StepReport = dyn Fn(StepEvent) + Send + Sync;

pub enum StepAnswer {
    Finished,
    Failed(String),
    Unavailable,
    Cancelled,
}

pub type StepOutcome<'a> = Pin<Box<dyn Future<Output = StepAnswer> + Send + 'a>>;

pub trait StepRunner: Send + Sync {
    fn run<'a>(&'a self, job: &'a PendingJob, report: &'a StepReport) -> StepOutcome<'a>;
}

#[derive(Clone, Debug)]
pub struct StatusEvent {
    pub project_id: i64,
    pub processing: Processing,
}

pub struct QueueOptions {
    pub reader: Arc<Reader>,
    pub writer: Arc<Writer>,
    pub runner: Arc<dyn StepRunner>,
    pub interval: Duration,
    pub idle_limit: Duration,
}

struct Snapshot {
    results: StepResults,
    failures: Vec<StepFailure>,
}

struct Running {
    snapshot: Snapshot,
    step: ActiveStep,
    activity: Instant,
}

pub struct Queue {
    reader: Arc<Reader>,
    writer: Arc<Writer>,
    runner: Arc<dyn StepRunner>,
    interval: Duration,
    idle_limit: Duration,
    running: Mutex<Option<Running>>,
    events: broadcast::Sender<StatusEvent>,
    wake: Notify,
    cancel: Notify,
    cancelled: Mutex<Option<i64>>,
}

fn read_pending(reader: &Reader) -> Result<Option<PendingJob>, BoxedError> {
    for step in QUEUE_ORDER {
        let pending = reader.pending_job(step)?;
        if pending.is_some() {
            return Ok(pending);
        }
    }
    Ok(None)
}

fn panic_message(panic: &(dyn std::any::Any + Send)) -> String {
    let text = panic
        .downcast_ref::<&str>()
        .map(|value| (*value).to_owned())
        .or_else(|| panic.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "unknown panic".to_owned());
    format!("The step panicked: {text}")
}

fn stuck_message(idle_limit: Duration) -> String {
    format!(
        "The step made no progress for {} seconds",
        idle_limit.as_secs()
    )
}

impl Queue {
    #[must_use]
    pub fn create(options: QueueOptions) -> Arc<Self> {
        let (events, _) = broadcast::channel(EVENT_CAPACITY);
        Arc::new(Self {
            reader: options.reader,
            writer: options.writer,
            runner: options.runner,
            interval: options.interval,
            idle_limit: options.idle_limit,
            running: Mutex::new(None),
            events,
            wake: Notify::new(),
            cancel: Notify::new(),
            cancelled: Mutex::new(None),
        })
    }

    #[must_use]
    pub fn subscribe(&self) -> broadcast::Receiver<StatusEvent> {
        self.events.subscribe()
    }

    pub fn wake(&self) {
        self.wake.notify_one();
    }

    pub fn cancel_project(&self, project_id: i64) {
        if let Ok(mut cancelled) = self.cancelled.lock() {
            *cancelled = Some(project_id);
        }
        self.cancel.notify_one();
    }

    pub async fn processing(&self, project_id: i64) -> Result<Processing, BoxedError> {
        let snapshot = self.read_snapshot(project_id).await?;
        let guard = self.running.lock().map_err(|_| "the queue is poisoned")?;
        let active = guard
            .as_ref()
            .map(|running| &running.step)
            .filter(|step| step.project_id == project_id);
        Ok(build_processing(
            &snapshot.results,
            &snapshot.failures,
            active,
        ))
    }

    pub fn spawn(self: &Arc<Self>) {
        let queue = Arc::clone(self);
        tokio::spawn(queue.work());
    }

    pub async fn drain(self: &Arc<Self>) {
        let mut attempted = Vec::new();
        while let Some(job) = self.next_job().await {
            let attempt = (job.project_id, job.step);
            if attempted.contains(&attempt) {
                return;
            }
            attempted.push(attempt);
            if !self.run_job(job).await {
                return;
            }
        }
    }

    async fn work(self: Arc<Self>) {
        loop {
            self.drain().await;
            tokio::select! {
                () = self.wake.notified() => {}
                () = sleep(self.interval) => {}
            }
        }
    }

    async fn next_job(&self) -> Option<PendingJob> {
        let reader = Arc::clone(&self.reader);
        let found = spawn_blocking(move || read_pending(&reader)).await;
        found.ok()?.ok()?
    }

    async fn run_job(self: &Arc<Self>, job: PendingJob) -> bool {
        let project_id = job.project_id;
        let step = job.step;
        if !self.start(&job).await {
            return false;
        }
        self.publish(project_id).await;
        let queue = Arc::clone(self);
        let report = move |event| queue.report(event);
        let answer = self.execute(&job, &report).await;
        if let StepAnswer::Failed(message) = &answer {
            self.record_failure(project_id, step, message.clone()).await;
        }
        if let Ok(mut running) = self.running.lock() {
            *running = None;
        }
        self.publish(project_id).await;
        !matches!(answer, StepAnswer::Unavailable | StepAnswer::Cancelled)
    }

    async fn execute(&self, job: &PendingJob, report: &StepReport) -> StepAnswer {
        let run = AssertUnwindSafe(self.runner.run(job, report)).catch_unwind();
        tokio::pin!(run);
        loop {
            tokio::select! {
                answered = &mut run => {
                    return answered
                        .unwrap_or_else(|panic| StepAnswer::Failed(panic_message(&*panic)));
                }
                () = self.cancel.notified() => {
                    if self.cancelled_target() == Some(job.project_id) {
                        return StepAnswer::Cancelled;
                    }
                }
                () = sleep(self.idle_limit) => {
                    if self.idle_for().is_none_or(|elapsed| elapsed >= self.idle_limit) {
                        return StepAnswer::Failed(stuck_message(self.idle_limit));
                    }
                }
            }
        }
    }

    fn cancelled_target(&self) -> Option<i64> {
        self.cancelled.lock().ok().and_then(|guard| *guard)
    }

    fn idle_for(&self) -> Option<Duration> {
        self.running
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().map(|running| running.activity.elapsed()))
    }

    async fn start(&self, job: &PendingJob) -> bool {
        let Ok(snapshot) = self.read_snapshot(job.project_id).await else {
            return false;
        };
        let Ok(mut running) = self.running.lock() else {
            return false;
        };
        *running = Some(Running {
            snapshot,
            step: ActiveStep {
                step: job.step,
                project_id: job.project_id,
                progress: 0.0,
                download: None,
            },
            activity: Instant::now(),
        });
        if let Ok(mut cancelled) = self.cancelled.lock() {
            *cancelled = None;
        }
        true
    }

    fn report(&self, event: StepEvent) {
        let Ok(mut guard) = self.running.lock() else {
            return;
        };
        let Some(running) = guard.as_mut() else {
            return;
        };
        running.activity = Instant::now();
        match event {
            StepEvent::Progress(progress) => running.step.progress = progress,
            StepEvent::Download(download) => running.step.download = Some(download),
        }
        let processing = build_processing(
            &running.snapshot.results,
            &running.snapshot.failures,
            Some(&running.step),
        );
        let _ = self.events.send(StatusEvent {
            project_id: running.step.project_id,
            processing,
        });
    }

    async fn record_failure(&self, project_id: i64, step: ProcessingStep, message: String) {
        let writer = Arc::clone(&self.writer);
        let _ = spawn_blocking(move || writer.record_failure(project_id, step, &message)).await;
    }

    async fn publish(&self, project_id: i64) {
        let Ok(processing) = self.processing(project_id).await else {
            return;
        };
        let _ = self.events.send(StatusEvent {
            project_id,
            processing,
        });
    }

    async fn read_snapshot(&self, project_id: i64) -> Result<Snapshot, BoxedError> {
        let reader = Arc::clone(&self.reader);
        spawn_blocking(move || {
            Ok::<_, BoxedError>(Snapshot {
                results: reader.step_results(project_id)?,
                failures: reader.step_failures(project_id)?,
            })
        })
        .await?
    }
}
