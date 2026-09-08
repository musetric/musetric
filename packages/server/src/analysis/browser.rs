use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
};

use axum::body::Bytes;
use musetric_db::{Analysis, PendingJob, blob_path};
use musetric_gpu::{
    Download, ExecutorFailure, ExecutorHost, ExecutorHostOptions, ExecutorPass, ExecutorPhase,
    ModelFile, PhaseSink, UnitSession, ensure_model_file,
};
use musetric_jobs::{StepAnswer, StepPass, StepPhase, StepReport};
use musetric_media::{
    Downmix, MonoRequest, PcmRequest, decode_mono_pcm, read_flac_sample_rate, read_frame_count,
};
use serde_json::{Map, Value, json};
use tokio::{fs::write, sync::mpsc};
use uuid::Uuid;

use crate::{
    analysis::{AnalysisContext, json_units::JsonUnits},
    blobs::{StagedBlob, close_area, ensure_area, stage_blob, step_area},
    pages::{HeldPage, PageFailure},
    publish::publish,
    storage::write_database,
};

const DECODE_REPORTS: u64 = 100;

#[derive(Debug)]
pub(crate) enum Failure {
    Refused(String),
    Unreachable,
}

impl From<musetric_db::BoxedError> for Failure {
    fn from(error: musetric_db::BoxedError) -> Self {
        Self::Refused(error.to_string())
    }
}

impl From<PageFailure> for Failure {
    fn from(failure: PageFailure) -> Self {
        match failure {
            PageFailure::Refused(message) => Self::Refused(message),
            PageFailure::Unreachable => Self::Unreachable,
        }
    }
}

impl From<ExecutorFailure> for Failure {
    fn from(failure: ExecutorFailure) -> Self {
        match failure {
            ExecutorFailure::Refused(message) => Self::Refused(message),
            ExecutorFailure::Unavailable => Self::Unreachable,
        }
    }
}

impl From<String> for Failure {
    fn from(message: String) -> Self {
        Self::Refused(message)
    }
}

pub(crate) enum Serve {
    Files,
    Directory(PathBuf),
}

pub(crate) struct HostedModel {
    urls: HashMap<String, String>,
    root: Option<String>,
}

impl HostedModel {
    pub(crate) fn create(urls: HashMap<String, String>, root: Option<String>) -> Self {
        Self { urls, root }
    }

    pub(crate) fn url(&self, file: &str) -> Result<&str, Failure> {
        self.urls
            .get(file)
            .map(String::as_str)
            .ok_or_else(|| Failure::Refused(format!("The model cache is missing {file}")))
    }

    pub(crate) fn root(&self) -> Result<&str, Failure> {
        self.root.as_deref().ok_or_else(|| {
            Failure::Refused("The model cache is not served as a directory".to_owned())
        })
    }
}

pub(crate) type BuildRequest = fn(&str, &str, &HostedModel) -> Result<Value, Failure>;

pub(crate) struct BrowserAnalysis {
    pub(crate) label: &'static str,
    pub(crate) api: &'static str,
    pub(crate) stored: Analysis,
    pub(crate) sample_rate: u32,
    pub(crate) downmix: Downmix,
    pub(crate) require_shader_f16: bool,
    pub(crate) files: Vec<ModelFile>,
    pub(crate) serve: Serve,
    pub(crate) build: BuildRequest,
}

pub(crate) fn read_phase(phase: ExecutorPhase) -> StepPhase {
    match phase {
        ExecutorPhase::Loading => StepPhase::Loading,
        ExecutorPhase::Running {
            pass,
            unit,
            unit_count,
        } => StepPhase::Running {
            pass: read_pass(pass),
            unit,
            unit_count,
        },
    }
}

fn read_pass(pass: ExecutorPass) -> StepPass {
    match pass {
        ExecutorPass::Decode => StepPass::Decode,
        ExecutorPass::Repair => StepPass::Repair,
    }
}

pub(crate) async fn run(
    context: &AnalysisContext,
    job: &PendingJob,
    report: &StepReport,
    analysis: &BrowserAnalysis,
) -> StepAnswer {
    answer(analyze(context, job, report, analysis).await)
}

pub(crate) fn answer(found: Result<(), Failure>) -> StepAnswer {
    match found {
        Ok(()) => StepAnswer::Finished,
        Err(Failure::Refused(message)) => StepAnswer::Failed(message),
        Err(Failure::Unreachable) => StepAnswer::Unavailable,
    }
}

async fn analyze(
    context: &AnalysisContext,
    job: &PendingJob,
    report: &StepReport,
    analysis: &BrowserAnalysis,
) -> Result<(), Failure> {
    let files = ensure_files(context, report, &analysis.files).await?;
    let source = blob_path(&context.storage.blobs_path, &job.blob_id);
    let request = PcmRequest {
        from: &source,
        sample_rate: analysis.sample_rate,
    };
    let mut decoded = decode_reporter(report, count_frames(&source, analysis.sample_rate).await?);
    let pcm = decode_mono_pcm(MonoRequest {
        source: context.storage.pcm.as_ref(),
        request,
        downmix: analysis.downmix,
        decoded: &mut decoded,
    })
    .await?;
    report(StepPhase::Loading);
    let result = drive(DriveJob {
        context,
        job,
        report,
        analysis,
        pcm,
        files,
    })
    .await?;
    report(StepPhase::Saving);
    store(context, job, analysis.stored, &result).await?;
    Ok(())
}

struct DriveJob<'drive> {
    context: &'drive AnalysisContext,
    job: &'drive PendingJob,
    report: &'drive StepReport,
    analysis: &'drive BrowserAnalysis,
    pcm: Vec<u8>,
    files: Vec<(String, PathBuf)>,
}

#[expect(
    clippy::cognitive_complexity,
    reason = "the unit handshake is a linear sequence of selects"
)]
async fn drive(job: DriveJob<'_>) -> Result<Value, Failure> {
    let attempt_id = Uuid::new_v4().to_string();
    let area = step_area(
        &job.context.storage.work_path,
        job.job.project_id,
        job.job.step,
    );
    ensure_area(&area).await?;
    let units = Arc::new(JsonUnits::create(area.join("incoming")));
    units.register(attempt_id.clone(), Arc::new(job.pcm))?;
    let (phases, mut reported) = mpsc::unbounded_channel();
    let sink: PhaseSink = Arc::new(move |phase| {
        let _ = phases.send(phase);
    });
    let host = ExecutorHost::start(ExecutorHostOptions {
        label: job.analysis.label.to_owned(),
        bundle: job.context.bundle.clone(),
        pcm: Bytes::from(Vec::new()),
        require_shader_f16: job.analysis.require_shader_f16,
        on_phase: sink,
        units: Some(Arc::clone(&units) as Arc<dyn UnitSession>),
    })
    .await?;
    let page = job.context.pages.open_page(&host.page_url()).await?;
    let held = HeldPage::hold(job.context.pages.as_ref(), page);
    host.wait_ready().await?;
    let bound = write_database(&job.context.storage, {
        let project_id = job.job.project_id;
        let step = job.job.step;
        let attempt = attempt_id.clone();
        move |writer| writer.bind_attempt(project_id, step, attempt)
    })
    .await?;
    if !bound {
        drop(held);
        host.close().await;
        return Err(Failure::Refused("the attempt is not active".to_owned()));
    }
    let hosted = register_files(&host, &job.analysis.serve, &job.files).await?;
    let request = (job.analysis.build)(&attempt_id, &host.attempt_url(&attempt_id), &hosted)?;
    let ticket = host.send_job(job.analysis.api, &request)?;
    let mut answered = Box::pin(async move { ticket.wait().await });
    tokio::select! {
        finished = &mut answered => {
            drop(held);
            host.close().await;
            return early_job(finished);
        }
        outcome = units.wait_opened(&attempt_id) => outcome?,
    }
    (job.report)(StepPhase::Running {
        pass: StepPass::Decode,
        unit: 0,
        unit_count: 1,
    });
    host.send_unit(&attempt_id, 0, 1)?;
    tokio::select! {
        finished = &mut answered => {
            drop(held);
            host.close().await;
            return early_job(finished);
        }
        outcome = units.folded(&attempt_id) => outcome?,
    }
    host.send_unit_close(&attempt_id)?;
    loop {
        tokio::select! {
            finished = &mut answered => {
                finished.map_err(Failure::from)?;
                break;
            }
            received = reported.recv() => {
                if let Some(phase) = received {
                    (job.report)(read_phase(phase));
                }
            }
        }
    }
    drop(held);
    host.close().await;
    units.finalize(&attempt_id)
}

fn early_job(finished: Result<Value, ExecutorFailure>) -> Result<Value, Failure> {
    finished.map_err(Failure::from)?;
    Err(Failure::Refused(
        "the analysis job answered before the close".to_owned(),
    ))
}

async fn register_files(
    host: &ExecutorHost,
    serve: &Serve,
    files: &[(String, PathBuf)],
) -> Result<HostedModel, Failure> {
    if let Serve::Directory(root) = serve {
        return Ok(HostedModel::create(
            HashMap::new(),
            Some(host.register_directory(root).await?),
        ));
    }
    let mut urls = HashMap::new();
    for (file, path) in files {
        urls.insert(file.clone(), host.register_file(path).await?);
    }
    Ok(HostedModel::create(urls, None))
}

pub(crate) async fn count_frames(source: &Path, sample_rate: u32) -> Result<u64, Failure> {
    let frames = read_frame_count(source).await?;
    let stored = read_flac_sample_rate(source).await?;
    Ok(frames * u64::from(sample_rate) / u64::from(stored))
}

pub(crate) fn decode_reporter(report: &StepReport, total: u64) -> impl FnMut(u64) + Send {
    let stride = total.div_ceil(DECODE_REPORTS).max(1);
    let mut announced = 0;
    move |decoded| {
        if decoded < announced + stride && decoded < total {
            return;
        }
        announced = decoded;
        report(StepPhase::Decoding { decoded, total });
    }
}

pub(crate) async fn ensure_files(
    context: &AnalysisContext,
    report: &StepReport,
    files: &[ModelFile],
) -> Result<Vec<(String, PathBuf)>, Failure> {
    let announce = |download: &Download| {
        report(StepPhase::Preparing {
            download: Some(describe(download)),
        });
    };
    let mut cached = Vec::new();
    for model in files {
        cached.push((
            model.file.clone(),
            ensure_model_file(&context.client, model, &announce).await?,
        ));
    }
    Ok(cached)
}

pub(crate) fn describe(download: &Download) -> Value {
    let mut message = Map::new();
    message.insert("label".to_owned(), json!(download.label));
    message.insert("file".to_owned(), json!(download.file));
    message.insert("downloaded".to_owned(), json!(download.downloaded));
    if let Some(total) = download.total {
        message.insert("total".to_owned(), json!(total));
    }
    message.insert("status".to_owned(), json!(download.status.name()));
    Value::Object(message)
}

pub(crate) async fn store(
    context: &AnalysisContext,
    job: &PendingJob,
    stored: Analysis,
    result: &Value,
) -> Result<(), Failure> {
    let area = step_area(&context.storage.work_path, job.project_id, job.step);
    ensure_area(&area).await?;
    let staged = stage_blob(&area, &context.storage.blobs_path);
    let written = write_payload(&staged, result).await;
    if written.is_ok() {
        let project_id = job.project_id;
        let blob_id = staged.blob_id().to_owned();
        let recorded = publish(&context.storage, &[&staged], move |writer| {
            writer.apply_analysis_result(stored, project_id, &blob_id)
        })
        .await;
        close_area(&area).await;
        recorded?;
        return Ok(());
    }
    close_area(&area).await;
    written
}

async fn write_payload(staged: &StagedBlob, result: &Value) -> Result<(), Failure> {
    let payload = serde_json::to_string_pretty(result).map_err(|error| error.to_string())?;
    write(staged.path(), payload)
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}
