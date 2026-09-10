use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use axum::body::Bytes;
use musetric_db::{PendingJob, ProcessingStep};
use musetric_gpu::{
    ExecutorFailure, ExecutorHost, ExecutorHostOptions, ExecutorPhase, PhaseSink, UnitSession,
};
use musetric_jobs::{StepAnswer, StepPass, StepPhase, StepReport};
use serde_json::Value;
use tokio::sync::mpsc;

use crate::{
    analysis::{
        AnalysisContext,
        browser::{Failure, answer, read_phase},
        checkpoint_persist::{CheckpointCursor, persist_tail},
        stage_units::{StageRegistration, StageResume, StageUnits},
    },
    blobs::{StagedBlob, close_area, ensure_area, step_area},
    checkpoint::{CheckpointDir, area_root, restore_refused},
    pages::HeldPage,
    storage::{read_database, write_database},
    unit_fold::FoldAccumulator,
};

pub(crate) const UNIT_OUTPUT: &str = "separated";
const API_NAME: &str = "musetricAiSeparateUnits";
const CHECKPOINT_EVERY: u32 = 2;
const NOT_ACTIVE: &str = "the attempt is not active";

pub(crate) struct StageRun<'run> {
    pub(crate) context: &'run AnalysisContext,
    pub(crate) report: &'run StepReport,
    pub(crate) project_id: i64,
    pub(crate) step: ProcessingStep,
}

impl StageRun<'_> {
    pub(crate) async fn project_sample_rate(&self) -> Result<u32, Failure> {
        let project_id = self.project_id;
        let found = read_database(&self.context.storage, move |database| {
            database.project(project_id)
        })
        .await?;
        let project = found
            .ok_or_else(|| Failure::Refused(format!("Project with id {project_id} not found")))?;
        u32::try_from(project.sample_rate)
            .map_err(|_| Failure::Refused("The project sample rate is out of range".to_owned()))
    }
}

pub(crate) trait StepStems: Sized {
    fn create(area: &Path, blobs_path: &Path) -> Self;
    fn staged(&self) -> Vec<&StagedBlob>;
}

pub(crate) async fn run_step<Stems: StepStems>(
    context: &AnalysisContext,
    job: &PendingJob,
    report: &StepReport,
    produce: impl AsyncFnOnce(&StageRun<'_>, &PendingJob, &Stems) -> Result<(), Failure>,
) -> StepAnswer {
    let area = step_area(&context.storage.work_path, job.project_id, job.step);
    if let Err(error) = ensure_area(&area).await {
        return answer(Err(Failure::from(error.to_string())));
    }
    let stems = Stems::create(&area, &context.storage.blobs_path);
    let running = StageRun {
        context,
        report,
        project_id: job.project_id,
        step: job.step,
    };
    let found = produce(&running, job, &stems).await;
    if found.is_ok() {
        close_area(&area).await;
    }
    answer(found)
}

pub(crate) struct StageStart<'start> {
    pub(crate) label: &'static str,
    pub(crate) pass: &'static str,
    pub(crate) computation: String,
    pub(crate) input: &'start [f32],
}

pub(crate) struct StageAttempt<'run> {
    running: &'run StageRun<'run>,
    host: ExecutorHost,
    units: Arc<StageUnits>,
    reported: mpsc::UnboundedReceiver<ExecutorPhase>,
    pass: &'static str,
    computation: String,
    store: CheckpointDir,
}

impl<'run> StageAttempt<'run> {
    pub(crate) async fn start(
        running: &'run StageRun<'run>,
        start: StageStart<'_>,
    ) -> Result<Self, Failure> {
        let store = CheckpointDir::create(area_root(
            &running.context.storage.work_path,
            running.project_id,
            running.step.name(),
            &start.computation,
        ));
        store
            .write_input(start.input)
            .await
            .map_err(|error| Failure::from(error.to_string()))?;
        let units = Arc::new(StageUnits::create(store.incoming_root()));
        let (phases, reported) = mpsc::unbounded_channel();
        let sink: PhaseSink = Arc::new(move |phase| {
            let _ = phases.send(phase);
        });
        let host = ExecutorHost::start(ExecutorHostOptions {
            label: start.label.to_owned(),
            bundle: running.context.bundle.clone(),
            pcm: Bytes::from(Vec::new()),
            require_shader_f16: true,
            on_phase: sink,
            units: Some(Arc::clone(&units) as Arc<dyn UnitSession>),
        })
        .await?;
        Ok(Self {
            running,
            host,
            units,
            reported,
            pass: start.pass,
            computation: start.computation,
            store,
        })
    }

    pub(crate) async fn open(&self) -> Result<HeldPage<'run>, Failure> {
        let pages = self.running.context.pages.as_ref();
        let page = pages.open_page(&self.host.page_url()).await?;
        let held = HeldPage::hold(pages, page);
        self.host.wait_ready().await?;
        Ok(held)
    }

    pub(crate) async fn register(&self, path: &Path) -> Result<String, Failure> {
        Ok(self.host.register_file(path).await?)
    }

    pub(crate) fn attempt_url(&self, attempt_id: &str) -> String {
        self.host.attempt_url(attempt_id)
    }

    pub(crate) async fn close(self) {
        self.host.close().await;
    }

    pub(crate) async fn resume(
        &self,
        frames: u64,
        channels: u32,
    ) -> Result<Option<StageResume>, Failure> {
        let project_id = self.running.project_id;
        let step = self.running.step;
        let found = read_database(&self.running.context.storage, move |reader| {
            reader.step_checkpoint(project_id, step)
        })
        .await?;
        let Some(cursor) = found else {
            return Ok(None);
        };
        if cursor.computation_id.as_deref() != Some(self.computation.as_str())
            || cursor.pass.as_deref() != Some(self.pass)
            || cursor.generation == 0
        {
            return Ok(None);
        }
        let tail = self
            .store
            .read_tail(cursor.generation)
            .await
            .map_err(|_| Failure::Refused(restore_refused("the tail file is missing")))?;
        if Some(tail.digest.as_str()) != cursor.tail_hash.as_deref() {
            return Err(Failure::Refused(restore_refused(
                "the tail hash does not match",
            )));
        }
        let fold = FoldAccumulator::from_bytes(&tail.bytes, frames, channels)
            .ok_or_else(|| Failure::Refused(restore_refused("the tail is not a fold")))?;
        Ok(Some(StageResume {
            fold,
            next_unit: cursor.next_unit,
        }))
    }

    pub(crate) async fn run(
        &mut self,
        registration: StageRegistration,
        request: Value,
    ) -> Result<Vec<f32>, Failure> {
        let attempt_id = registration.attempt.clone();
        self.stage(registration, request).await?;
        self.units.finalize(&attempt_id)
    }

    async fn stage(
        &mut self,
        registration: StageRegistration,
        request: Value,
    ) -> Result<(), Failure> {
        let count = registration.plan.unit_count();
        let attempt_id = registration.attempt.clone();
        self.units.register(registration)?;
        self.bind(&attempt_id).await?;
        let start = self.units.next_unit(&attempt_id)?;
        let ticket = self.host.send_job(API_NAME, &request)?;
        let mut answered = Box::pin(async move { ticket.wait().await });
        tokio::select! {
            finished = &mut answered => return early_job(finished),
            outcome = self.units.wait_opened(&attempt_id) => outcome?,
        }
        for index in start..count {
            (self.running.report)(StepPhase::Running {
                pass: StepPass::Decode,
                unit: index,
                unit_count: count,
            });
            self.host.send_unit(&attempt_id, index, count)?;
            self.drain_phases();
            tokio::select! {
                finished = &mut answered => return early_job(finished),
                outcome = self.units.folded(&attempt_id, index) => outcome?,
            }
            self.persist(&attempt_id, index + 1, count).await?;
        }
        self.host.send_unit_close(&attempt_id)?;
        loop {
            tokio::select! {
                finished = &mut answered => {
                    finished.map_err(Failure::from)?;
                    return Ok(());
                }
                received = self.reported.recv() => {
                    if let Some(phase) = received {
                        (self.running.report)(read_phase(phase));
                    }
                }
            }
        }
    }

    fn drain_phases(&mut self) {
        while let Ok(phase) = self.reported.try_recv() {
            (self.running.report)(read_phase(phase));
        }
    }

    async fn bind(&self, attempt: &str) -> Result<(), Failure> {
        let project_id = self.running.project_id;
        let step = self.running.step;
        let attempt_id = attempt.to_owned();
        let bound = write_database(&self.running.context.storage, move |writer| {
            writer.bind_attempt(project_id, step, attempt_id)
        })
        .await?;
        if bound {
            Ok(())
        } else {
            Err(Failure::Refused(NOT_ACTIVE.to_owned()))
        }
    }

    async fn persist(&self, attempt: &str, next_unit: u32, count: u32) -> Result<(), Failure> {
        if next_unit != count && !next_unit.is_multiple_of(CHECKPOINT_EVERY) {
            return Ok(());
        }
        let bytes = self.units.snapshot(attempt)?;
        persist_tail(
            &self.running.context.storage,
            &self.store,
            bytes,
            CheckpointCursor {
                project_id: self.running.project_id,
                step: self.running.step,
                attempt_id: attempt,
                computation_id: &self.computation,
                pass: self.pass,
                next_unit,
                unit_count: count,
            },
        )
        .await
    }
}

pub(crate) fn cached_model(models: &[(String, PathBuf)], name: &str) -> Result<PathBuf, Failure> {
    models
        .iter()
        .find(|(file, _)| file == name)
        .map(|(_, path)| path.clone())
        .ok_or_else(|| Failure::Refused(format!("The model cache is missing {name}")))
}

fn early_job(finished: Result<Value, ExecutorFailure>) -> Result<(), Failure> {
    finished.map_err(Failure::from)?;
    Err(Failure::Refused(
        "the separation job answered before the close".to_owned(),
    ))
}
