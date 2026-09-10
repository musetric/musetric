use std::{future::Future, pin::Pin, sync::Arc};

use axum::body::Bytes;
use musetric_db::{Analysis, PendingJob, blob_path};
use musetric_gpu::{
    ExecutorFailure, ExecutorHost, ExecutorHostOptions, ExecutorPhase, JobTicket, PhaseSink,
    UnitSession,
};
use musetric_jobs::{StepAnswer, StepPass, StepPhase, StepReport};
use musetric_media::{MonoRequest, PcmRequest, decode_mono_pcm};
use serde_json::{Value, json};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::{
    analysis::{
        AnalysisContext,
        browser::{
            Failure, answer, count_frames, decode_reporter, ensure_files, read_phase, store,
        },
        checkpoint_persist::{CheckpointCursor, persist_tail},
        models::{WHISPER, whisper_graph},
        transcribe_units::{
            CHUNK_SIZE_SECONDS, Plan, REPAIR_UNITS, Restored, SEAM_SECONDS, StartPass,
            TranscribeState, TranscribeUnits, restore_state,
        },
    },
    blobs::{ensure_area, step_area},
    checkpoint::{CheckpointDir, area_root, computation_id, digest_samples, restore_refused},
    pages::HeldPage,
    storage::{read_database, write_database},
};

const LABEL: &str = "Headless transcription";
const API_NAME: &str = "musetricAiTranscribeAudio";
const OUTPUT: &str = "result";
const DSP_VERSION: &str = "transcription-dsp-v1";
const PASS_DECODE: &str = "decode";
const PASS_REPAIR: &str = "repair";
const ANSWERED_EARLY: &str = "the analysis job answered before the close";
const NOT_ACTIVE: &str = "the attempt is not active";

type Answered = Pin<Box<dyn Future<Output = Result<Value, ExecutorFailure>> + Send>>;

pub(crate) async fn run(
    context: &AnalysisContext,
    job: &PendingJob,
    report: &StepReport,
) -> StepAnswer {
    answer(transcribe(context, job, report).await)
}

async fn transcribe(
    context: &AnalysisContext,
    job: &PendingJob,
    report: &StepReport,
) -> Result<(), Failure> {
    ensure_files(context, report, &WHISPER.cached(&context.models_path)).await?;
    let source = blob_path(&context.storage.blobs_path, &job.blob_id);
    let mut decoded = decode_reporter(report, count_frames(&source, WHISPER.sample_rate).await?);
    let pcm = decode_mono_pcm(MonoRequest {
        source: context.storage.pcm.as_ref(),
        request: PcmRequest {
            from: &source,
            sample_rate: WHISPER.sample_rate,
        },
        downmix: WHISPER.downmix,
        decoded: &mut decoded,
    })
    .await?;
    let samples = decode_samples(&pcm);
    (report)(StepPhase::Loading);
    let result = drive(context, job, report, samples).await?;
    (report)(StepPhase::Saving);
    store(context, job, Analysis::Subtitle, &result).await
}

fn decode_samples(pcm: &[u8]) -> Vec<f32> {
    pcm.chunks_exact(4)
        .filter_map(|raw| raw.first_chunk::<4>())
        .map(|raw| f32::from_le_bytes(*raw))
        .collect()
}

async fn drive(
    context: &AnalysisContext,
    job: &PendingJob,
    report: &StepReport,
    samples: Vec<f32>,
) -> Result<Value, Failure> {
    let computation = computation_id(&[
        DSP_VERSION,
        &digest_samples(&samples),
        WHISPER.model_id,
        WHISPER.revision,
    ]);
    let area = step_area(&context.storage.work_path, job.project_id, job.step);
    ensure_area(&area).await?;
    let checkpoint = CheckpointDir::create(area_root(
        &context.storage.work_path,
        job.project_id,
        job.step.name(),
        &computation,
    ));
    checkpoint
        .write_input(&samples)
        .await
        .map_err(|error| Failure::from(error.to_string()))?;
    let restored = restore(
        &checkpoint,
        context,
        job,
        &Identity {
            computation: &computation,
            samples: &samples,
        },
    )
    .await?;
    let state = restored
        .as_ref()
        .map_or_else(TranscribeState::default, |found| found.state.clone());
    let attempt_id = Uuid::new_v4().to_string();
    let units = Arc::new(TranscribeUnits::create(
        area.join("incoming"),
        Arc::new(samples),
        WHISPER.sample_rate,
        state,
    ));
    units.register(&attempt_id)?;
    let (phases, mut reported) = mpsc::unbounded_channel();
    let sink: PhaseSink = Arc::new(move |phase| {
        let _ = phases.send(phase);
    });
    let host = ExecutorHost::start(ExecutorHostOptions {
        label: LABEL.to_owned(),
        bundle: context.bundle.clone(),
        pcm: Bytes::from(Vec::new()),
        require_shader_f16: true,
        on_phase: sink,
        units: Some(Arc::clone(&units) as Arc<dyn UnitSession>),
    })
    .await?;
    let page = context.pages.open_page(&host.page_url()).await?;
    let held = HeldPage::hold(context.pages.as_ref(), page);
    let opened = open_attempt(context, job, &host, &attempt_id).await;
    let outcome = match opened {
        Ok(ticket) => {
            attempt(
                Run {
                    context,
                    job,
                    report,
                    reported: &mut reported,
                    attempt_id: &attempt_id,
                    computation: &computation,
                    checkpoint: &checkpoint,
                    host: &host,
                    units: &units,
                },
                ticket,
                restored,
            )
            .await
        }
        Err(failure) => Err(failure),
    };
    drop(held);
    host.close().await;
    outcome?;
    units.finalize()
}

struct Identity<'run> {
    computation: &'run str,
    samples: &'run [f32],
}

async fn restore(
    checkpoint: &CheckpointDir,
    context: &AnalysisContext,
    job: &PendingJob,
    identity: &Identity<'_>,
) -> Result<Option<Restored>, Failure> {
    let project_id = job.project_id;
    let step = job.step;
    let expected = identity.computation.to_owned();
    let found = read_database(&context.storage, move |reader| {
        reader.step_checkpoint(project_id, step)
    })
    .await?;
    let Some(cursor) = found else {
        return Ok(None);
    };
    if cursor.computation_id.as_deref() != Some(expected.as_str()) || cursor.generation == 0 {
        return Ok(None);
    }
    let tail = checkpoint
        .read_tail(cursor.generation)
        .await
        .map_err(|_| Failure::Refused(restore_refused("the tail file is missing")))?;
    if Some(tail.digest.as_str()) != cursor.tail_hash.as_deref() {
        return Err(Failure::Refused(restore_refused(
            "the tail hash does not match",
        )));
    }
    let state = restore_state(&tail.bytes, identity.samples, WHISPER.sample_rate)
        .map_err(|reason| Failure::Refused(restore_refused(&reason)))?;
    let next_unit = cursor.next_unit;
    let pass = match cursor.pass.as_deref() {
        Some(PASS_DECODE) => {
            let chunks = state.plan.as_ref().map_or(0, Plan::chunk_count);
            let valid = (next_unit == 0 || state.plan.is_some()) && next_unit <= chunks;
            if !valid {
                return Err(Failure::Refused(restore_refused(
                    "the cursor is outside the plan",
                )));
            }
            StartPass::Decode
        }
        Some(PASS_REPAIR) if next_unit <= REPAIR_UNITS => StartPass::Repair,
        _ => return Err(Failure::Refused(restore_refused("the pass is unknown"))),
    };
    Ok(Some(Restored {
        state,
        pass,
        next_unit,
    }))
}

struct UnitStep {
    pass: StartPass,
    unit: u32,
    count: u32,
}

fn decode_step(unit: u32, count: u32) -> UnitStep {
    UnitStep {
        pass: StartPass::Decode,
        unit,
        count,
    }
}

fn repair_step(unit: u32) -> UnitStep {
    UnitStep {
        pass: StartPass::Repair,
        unit,
        count: REPAIR_UNITS,
    }
}

fn repair_start(pass: StartPass, next_unit: u32) -> u32 {
    if pass == StartPass::Repair {
        next_unit
    } else {
        0
    }
}

struct Run<'run> {
    context: &'run AnalysisContext,
    job: &'run PendingJob,
    report: &'run StepReport,
    reported: &'run mut mpsc::UnboundedReceiver<ExecutorPhase>,
    attempt_id: &'run str,
    computation: &'run str,
    checkpoint: &'run CheckpointDir,
    host: &'run ExecutorHost,
    units: &'run Arc<TranscribeUnits>,
}

impl Run<'_> {
    async fn run_unit(&mut self, answered: &mut Answered, step: UnitStep) -> Result<(), Failure> {
        (self.report)(StepPhase::Running {
            pass: step_pass(step.pass),
            unit: step.unit,
            unit_count: step.count,
        });
        self.host
            .send_unit(self.attempt_id, step.unit, step.count)
            .map_err(Failure::from)?;
        while let Ok(phase) = self.reported.try_recv() {
            (self.report)(read_phase(phase));
        }
        tokio::select! {
            finished = &mut *answered => {
                finished.map_err(Failure::from)?;
                Err(Failure::Refused(ANSWERED_EARLY.to_owned()))
            }
            outcome = self.units.folded(step.unit) => outcome,
        }
    }

    async fn persist(&self, step: UnitStep, next_unit: u32) -> Result<(), Failure> {
        let bytes = self.units.tail()?;
        persist_tail(
            &self.context.storage,
            self.checkpoint,
            bytes,
            CheckpointCursor {
                project_id: self.job.project_id,
                step: self.job.step,
                attempt_id: self.attempt_id,
                computation_id: self.computation,
                pass: pass_name(step.pass),
                next_unit,
                unit_count: step.count,
            },
        )
        .await
    }

    async fn finish(&mut self, answered: &mut Answered) -> Result<(), Failure> {
        self.host
            .send_unit_close(self.attempt_id)
            .map_err(Failure::from)?;
        loop {
            tokio::select! {
                finished = &mut *answered => {
                    finished.map_err(Failure::from)?;
                    return Ok(());
                }
                received = self.reported.recv() => {
                    if let Some(phase) = received {
                        (self.report)(read_phase(phase));
                    }
                }
            }
        }
    }
}

async fn attempt(
    mut run: Run<'_>,
    ticket: JobTicket,
    restored: Option<Restored>,
) -> Result<(), Failure> {
    let mut answered: Answered = Box::pin(async move { ticket.wait().await });
    tokio::select! {
        finished = &mut answered => {
            finished.map_err(Failure::from)?;
            return Err(Failure::Refused(ANSWERED_EARLY.to_owned()));
        }
        outcome = run.units.wait_opened() => outcome?,
    }
    let (pass, mut next) = restored.map_or((StartPass::Decode, 0), |found| {
        (found.pass, found.next_unit)
    });
    if pass == StartPass::Decode {
        run.units.set_pass(StartPass::Decode)?;
        if next == 0 {
            let count = run.units.pass_count(StartPass::Decode)?;
            run.run_unit(&mut answered, decode_step(0, count)).await?;
            run.persist(decode_step(0, count), 1).await?;
            next = 1;
        }
        let count = run.units.pass_count(StartPass::Decode)?;
        for unit in next..count {
            run.run_unit(&mut answered, decode_step(unit, count))
                .await?;
            run.persist(decode_step(unit, count), unit + 1).await?;
        }
    }
    run.units.set_pass(StartPass::Repair)?;
    for unit in repair_start(pass, next)..REPAIR_UNITS {
        run.run_unit(&mut answered, repair_step(unit)).await?;
        run.persist(repair_step(unit), unit + 1).await?;
    }
    run.finish(&mut answered).await
}

async fn open_attempt(
    context: &AnalysisContext,
    job: &PendingJob,
    host: &ExecutorHost,
    attempt_id: &str,
) -> Result<JobTicket, Failure> {
    host.wait_ready().await?;
    let project_id = job.project_id;
    let step = job.step;
    let attempt = attempt_id.to_owned();
    let bound = write_database(&context.storage, move |writer| {
        writer.bind_attempt(project_id, step, attempt)
    })
    .await?;
    if !bound {
        return Err(Failure::Refused(NOT_ACTIVE.to_owned()));
    }
    let models = WHISPER.root(&context.models_path);
    let hosted = host.register_directory(&models).await?;
    let request = request_json(attempt_id, &host.attempt_url(attempt_id), &hosted);
    host.send_job(API_NAME, &request).map_err(Failure::from)
}

pub(crate) fn request_json(attempt_id: &str, attempt_url: &str, model_host: &str) -> Value {
    json!({
        "attemptId": attempt_id,
        "attemptUrl": attempt_url,
        "outputs": [OUTPUT],
        "sampleRate": WHISPER.sample_rate,
        "chunkSize": CHUNK_SIZE_SECONDS,
        "seamSeconds": SEAM_SECONDS,
        "modelHost": model_host,
        "modelId": WHISPER.model_id,
        "revision": WHISPER.revision,
        "graph": whisper_graph(),
    })
}

fn pass_name(pass: StartPass) -> &'static str {
    match pass {
        StartPass::Decode => PASS_DECODE,
        StartPass::Repair => PASS_REPAIR,
    }
}

fn step_pass(pass: StartPass) -> StepPass {
    match pass {
        StartPass::Decode => StepPass::Decode,
        StartPass::Repair => StepPass::Repair,
    }
}

#[cfg(test)]
mod tests {
    use super::{StartPass, repair_start};

    #[test]
    fn resumes_repair_from_its_checkpoint() {
        assert_eq!(repair_start(StartPass::Decode, 4), 0);
        assert_eq!(repair_start(StartPass::Repair, 0), 0);
        assert_eq!(repair_start(StartPass::Repair, 1), 1);
        assert_eq!(repair_start(StartPass::Repair, 2), 2);
    }
}
