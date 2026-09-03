use std::{collections::HashMap, path::PathBuf, sync::Arc};

use axum::body::Bytes;
use musetric_db::{Analysis, PendingJob, blob_path};
use musetric_gpu::{
    Bundle, Download, ExecutorFailure, ExecutorHost, ExecutorHostOptions, ModelFile, ProgressSink,
    ensure_model_file,
};
use musetric_jobs::{StepAnswer, StepEvent, StepReport};
use musetric_media::{Downmix, PcmRequest, decode_mono_pcm};
use serde_json::{Map, Value, json};
use tokio::{fs::create_dir_all, fs::write, sync::mpsc};

use crate::{
    analysis::AnalysisContext,
    blobs::create_blob_ref,
    pages::{PageFailure, PageOpener},
    storage::write_database,
};

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

pub(crate) type BuildRequest = fn(&str, &HostedModel) -> Result<Value, Failure>;

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

pub(crate) struct SessionOptions {
    pub(crate) label: &'static str,
    pub(crate) bundle: Bundle,
    pub(crate) pcm: Vec<u8>,
    pub(crate) require_shader_f16: bool,
}

pub(crate) struct Job<'job> {
    pub(crate) api: &'job str,
    pub(crate) request: &'job Value,
    pub(crate) report: &'job StepReport,
}

pub(crate) struct Session {
    host: ExecutorHost,
    reported: mpsc::UnboundedReceiver<f64>,
}

impl Session {
    pub(crate) async fn start(options: SessionOptions) -> Result<Self, Failure> {
        let (progress, reported) = mpsc::unbounded_channel();
        let sink: ProgressSink = Arc::new(move |value| {
            let _ = progress.send(value);
        });
        let host = ExecutorHost::start(ExecutorHostOptions {
            label: options.label.to_owned(),
            bundle: options.bundle,
            pcm: Bytes::from(options.pcm),
            require_shader_f16: options.require_shader_f16,
            on_progress: sink,
        })
        .await?;
        Ok(Self { host, reported })
    }

    pub(crate) fn host(&self) -> &ExecutorHost {
        &self.host
    }

    pub(crate) async fn run(
        &mut self,
        pages: &dyn PageOpener,
        job: Job<'_>,
    ) -> Result<Value, Failure> {
        let page = pages.open_page(&self.host.page_url()).await?;
        let found = self.answer(job).await;
        pages.close_page(&page);
        found
    }

    async fn answer(&mut self, job: Job<'_>) -> Result<Value, Failure> {
        let Self { host, reported } = self;
        host.wait_ready().await?;
        let running = host.run(job.api, job.request);
        tokio::pin!(running);
        loop {
            tokio::select! {
                received = reported.recv() => {
                    if let Some(value) = received {
                        (job.report)(StepEvent::Progress(value));
                    }
                }
                answered = &mut running => return Ok(answered?),
            }
        }
    }

    pub(crate) async fn close(self) {
        self.host.close().await;
    }
}

struct Attempt<'attempt> {
    context: &'attempt AnalysisContext,
    report: &'attempt StepReport,
    analysis: &'attempt BrowserAnalysis,
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
    report(StepEvent::Progress(0.0));
    let files = ensure_files(context, report, &analysis.files).await?;
    let source = blob_path(&context.storage.blobs_path, &job.blob_id);
    let request = PcmRequest {
        from: &source,
        sample_rate: analysis.sample_rate,
    };
    let pcm = decode_mono_pcm(context.storage.pcm.as_ref(), request, analysis.downmix).await?;
    let mut session = Session::start(SessionOptions {
        label: analysis.label,
        bundle: context.bundle.clone(),
        pcm,
        require_shader_f16: analysis.require_shader_f16,
    })
    .await?;
    let attempt = Attempt {
        context,
        report,
        analysis,
    };
    let found = read_result(&attempt, &mut session, &files).await;
    session.close().await;
    let result = found?;
    store(context, job, analysis.stored, &result).await?;
    report(StepEvent::Progress(1.0));
    Ok(())
}

async fn read_result(
    attempt: &Attempt<'_>,
    session: &mut Session,
    files: &[(String, PathBuf)],
) -> Result<Value, Failure> {
    let analysis = attempt.analysis;
    let hosted = register_files(session.host(), &analysis.serve, files).await?;
    let request = (analysis.build)(&session.host().pcm_url(), &hosted)?;
    session
        .run(
            attempt.context.pages.as_ref(),
            Job {
                api: analysis.api,
                request: &request,
                report: attempt.report,
            },
        )
        .await
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

pub(crate) async fn ensure_files(
    context: &AnalysisContext,
    report: &StepReport,
    files: &[ModelFile],
) -> Result<Vec<(String, PathBuf)>, Failure> {
    let announce = |download: &Download| report(StepEvent::Download(describe(download)));
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
    let blob = create_blob_ref(&context.storage.blobs_path);
    let payload = serde_json::to_string_pretty(result).map_err(|error| error.to_string())?;
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
        writer.apply_analysis_result(stored, project_id, &blob_id)
    })
    .await?;
    Ok(())
}
