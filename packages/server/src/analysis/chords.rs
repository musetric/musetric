use std::{path::PathBuf, sync::Arc};

use axum::body::Bytes;
use musetric_db::{PendingJob, blob_path};
use musetric_gpu::{Download, ExecutorHost, ExecutorHostOptions, ProgressSink, ensure_model_file};
use musetric_jobs::{StepAnswer, StepEvent, StepReport};
use musetric_media::decode_mono_pcm;
use serde_json::{Map, Value, json};
use tokio::{fs::create_dir_all, fs::write, sync::mpsc};

use crate::{
    analysis::{
        AnalysisContext,
        models::{
            CHORD_NET_MODEL, CHORD_NET_PLAN, CHORD_NET_PLAN_MANIFEST, CHORD_NET_SAMPLE_RATE,
            chord_net_files,
        },
        page::{PageFailure, close_page, open_page},
    },
    blobs::create_blob_ref,
    storage::write_database,
};

const LABEL: &str = "Headless chords analysis";
const API_NAME: &str = "musetricAiAnalyzeChords";

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

pub(crate) async fn run(
    context: &AnalysisContext,
    job: &PendingJob,
    report: &StepReport,
) -> StepAnswer {
    match analyze(context, job, report).await {
        Ok(()) => StepAnswer::Finished,
        Err(Failure::Refused(message)) => StepAnswer::Failed(message),
        Err(Failure::Unreachable) => StepAnswer::Unavailable,
    }
}

struct ChordNetPaths {
    model: PathBuf,
    plan: PathBuf,
    plan_manifest: PathBuf,
}

async fn analyze(
    context: &AnalysisContext,
    job: &PendingJob,
    report: &StepReport,
) -> Result<(), Failure> {
    report(StepEvent::Progress(0.0));
    let files = ensure_files(context, report).await?;
    let source = blob_path(&context.storage.blobs_path, &job.blob_id);
    let pcm = decode_mono_pcm(&context.storage.tools, &source, CHORD_NET_SAMPLE_RATE).await?;
    let (progress, mut reported) = mpsc::unbounded_channel();
    let sink: ProgressSink = Arc::new(move |value| {
        let _ = progress.send(value);
    });
    let host = ExecutorHost::start(ExecutorHostOptions {
        label: LABEL.to_owned(),
        bundle_path: context.bundle_path.clone(),
        pcm: Bytes::from(pcm),
        require_shader_f16: false,
        on_progress: sink,
    })
    .await?;
    let running = Running {
        host: &host,
        reported: &mut reported,
        report,
    };
    let found = read_chords(context, running, &files).await;
    host.close().await;
    let chords = found?;
    store(context, job, &chords).await?;
    report(StepEvent::Progress(1.0));
    Ok(())
}

struct Running<'run> {
    host: &'run ExecutorHost,
    reported: &'run mut mpsc::UnboundedReceiver<f64>,
    report: &'run StepReport,
}

async fn read_chords(
    context: &AnalysisContext,
    running: Running<'_>,
    files: &ChordNetPaths,
) -> Result<Value, Failure> {
    let host = running.host;
    let request = json!({
        "pcmUrl": host.pcm_url(),
        "modelUrl": host.register_file(&files.model).await?,
        "planUrl": host.register_file(&files.plan).await?,
        "planManifestUrl": host.register_file(&files.plan_manifest).await?,
    });
    let page = open_page(&context.proxy, &host.page_url()).await?;
    let found = run_job(running, &request).await;
    close_page(&context.proxy, &page).await;
    found
}

async fn run_job(running: Running<'_>, request: &Value) -> Result<Value, Failure> {
    running.host.wait_ready().await?;
    let job = running.host.run(API_NAME, request);
    tokio::pin!(job);
    loop {
        tokio::select! {
            received = running.reported.recv() => {
                if let Some(value) = received {
                    (running.report)(StepEvent::Progress(value));
                }
            }
            answered = &mut job => return Ok(answered?),
        }
    }
}

async fn ensure_files(
    context: &AnalysisContext,
    report: &StepReport,
) -> Result<ChordNetPaths, Failure> {
    let announce = |download: &Download| report(StepEvent::Download(describe(download)));
    let mut paths = Vec::new();
    for model in chord_net_files(&context.models_path) {
        paths.push((
            model.file.clone(),
            ensure_model_file(&context.client, &model, &announce).await?,
        ));
    }
    let read = |name: &str| {
        paths
            .iter()
            .find(|(file, _)| file == name)
            .map(|(_, path)| path.clone())
            .ok_or_else(|| Failure::Refused(format!("The chords model cache is missing {name}")))
    };
    Ok(ChordNetPaths {
        model: read(CHORD_NET_MODEL)?,
        plan: read(CHORD_NET_PLAN)?,
        plan_manifest: read(CHORD_NET_PLAN_MANIFEST)?,
    })
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
    chords: &Value,
) -> Result<(), Failure> {
    let blob = create_blob_ref(&context.storage.blobs_path);
    let payload = serde_json::to_string_pretty(chords).map_err(|error| error.to_string())?;
    if let Some(directory) = blob.path.parent() {
        create_dir_all(directory)
            .await
            .map_err(|error| error.to_string())?;
    }
    write(&blob.path, payload)
        .await
        .map_err(|error| error.to_string())?;
    let project_id = job.project_id;
    let blob_id = blob.blob_id;
    write_database(&context.storage, move |writer| {
        writer.apply_chords_result(project_id, &blob_id)
    })
    .await?;
    Ok(())
}

impl From<String> for Failure {
    fn from(message: String) -> Self {
        Self::Refused(message)
    }
}
