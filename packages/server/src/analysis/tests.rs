use std::sync::{Arc, Mutex};

use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, post},
};
use musetric_db::{Analysis, PendingJob, ProcessingStep};
use musetric_gpu::{Download, DownloadStatus};
use musetric_media::Downmix;
use reqwest::Client;
use serde_json::{Value, json};
use tokio::fs::read_to_string;

use crate::{
    analysis::{
        AnalysisContext,
        browser::{FileUrls, describe, store},
        models::{CHORD_NET, CHORD_NET_MODEL},
        page::{PageFailure, close_page, open_page},
        steps::create as create_step,
    },
    proxy::ProxyState,
    storage::read,
    test_workspace::{Workspace, start_upstream},
};

const CREATE_PROJECT: &str = "
  INSERT INTO Project (id, name, sampleRate, frameCount)
  VALUES (1, 'Fixture project', 48000, 480000);
  INSERT INTO ProcessingError (projectId, step, message)
  VALUES (1, 'chords', 'Fixture failure');
";
const PAGE_ROUTE: &str = "/api/internal/gpu/page";
const PAGE_ID: &str = "page-1";

fn create_context(workspace: &Workspace, upstream: &str) -> AnalysisContext {
    let address = upstream
        .parse()
        .expect("the upstream should be a valid uri");
    AnalysisContext {
        storage: workspace.create_storage(),
        proxy: ProxyState::create(address),
        client: Client::new(),
        models_path: workspace.blobs_path().join("models"),
        bundle_path: workspace.blobs_path().join("bundle"),
    }
}

async fn start_page_upstream(
    closed: Arc<Mutex<Vec<String>>>,
) -> (String, tokio::sync::oneshot::Sender<()>) {
    let application = Router::new()
        .route(PAGE_ROUTE, post(|| async { Json(json!({ "pageId": PAGE_ID })) }))
        .route(
            &format!("{PAGE_ROUTE}/{{pageId}}"),
            delete(
                |State(state): State<Arc<Mutex<Vec<String>>>>, Path(page_id): Path<String>| async move {
                    state
                        .lock()
                        .expect("the close log should be writable")
                        .push(page_id);
                    StatusCode::OK
                },
            ),
        )
        .with_state(closed);
    let (address, shutdown) = start_upstream(application).await;
    (format!("http://{address}"), shutdown)
}

#[tokio::test]
async fn opens_and_closes_a_page_through_the_upstream_app() {
    let workspace = Workspace::new();
    let closed = Arc::new(Mutex::new(Vec::new()));
    let (upstream, shutdown) = start_page_upstream(Arc::clone(&closed)).await;
    let context = create_context(&workspace, &upstream);

    let page = open_page(&context.proxy, "http://127.0.0.1:1/?jobs=x")
        .await
        .map_err(|_| "the page should open")
        .expect("the page should open");
    close_page(&context.proxy, &page).await;

    assert_eq!(
        closed
            .lock()
            .expect("the close log should be readable")
            .as_slice(),
        [PAGE_ID]
    );
    let _ = shutdown.send(());
}

#[tokio::test]
async fn reports_an_unreachable_app_instead_of_a_failed_step() {
    let workspace = Workspace::new();
    let context = create_context(&workspace, "http://127.0.0.1:1");

    let refused = open_page(&context.proxy, "http://127.0.0.1:1/?jobs=x").await;

    assert!(matches!(refused, Err(PageFailure::Unreachable)));
}

#[tokio::test]
async fn stores_the_chords_the_executor_answered() {
    let workspace = Workspace::new();
    workspace.seed(CREATE_PROJECT);
    let context = create_context(&workspace, "http://127.0.0.1:1");
    let job = PendingJob {
        step: ProcessingStep::Chords,
        project_id: 1,
        blob_id: "instrumental-blob".to_owned(),
    };
    let chords = json!({ "segments": [{ "start": 0, "end": 1, "label": "C" }] });

    store(&context, &job, Analysis::Chords, &chords)
        .await
        .map_err(|_| "the chords should be stored")
        .expect("the chords should be stored");

    let stored = read(&context.storage, |database| {
        database.analysis_blob(musetric_db::Analysis::Chords, 1)
    })
    .await
    .expect("the blob id should be read")
    .expect("the chords should be recorded");
    let path = musetric_db::blob_path(&context.storage.blobs_path, &stored);
    let written = read_to_string(&path)
        .await
        .expect("the chords blob should be written");
    assert_eq!(
        written,
        "{\n  \"segments\": [\n    {\n      \"end\": 1,\n      \"label\": \"C\",\n      \"start\": 0\n    }\n  ]\n}"
    );
    let failures = read(&context.storage, |database| database.step_failures(1))
        .await
        .expect("the failures should be read");
    assert!(failures.is_empty());
}

#[test]
fn describes_a_download_the_way_the_api_expects() {
    let started = describe(&Download {
        label: "Chord recognition model",
        file: "chordnet.onnx",
        downloaded: 12,
        total: None,
        status: DownloadStatus::Processing,
    });
    let finished = describe(&Download {
        label: "Chord recognition model",
        file: "chordnet.onnx",
        downloaded: 40,
        total: Some(40),
        status: DownloadStatus::Done,
    });

    assert_eq!(
        started,
        json!({
            "label": "Chord recognition model",
            "file": "chordnet.onnx",
            "downloaded": 12,
            "status": "processing",
        })
    );
    assert_eq!(
        finished,
        json!({
            "label": "Chord recognition model",
            "file": "chordnet.onnx",
            "downloaded": 40,
            "total": 40,
            "status": "done",
        })
    );
}

#[test]
fn points_every_chord_model_file_at_its_cache_entry() {
    let files = CHORD_NET.cached(std::path::Path::new("/models"));

    let names = files
        .iter()
        .map(|model| model.file.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        names,
        [
            "config.json",
            "chordnet.onnx",
            "cqt-plan.bin",
            "cqt-plan.manifest.json"
        ]
    );
    let model = files
        .iter()
        .find(|file| file.file == CHORD_NET_MODEL)
        .expect("the model should be listed");
    assert_eq!(
        model.url,
        "https://huggingface.co/musetric/chordmini-onnx/resolve/fbd620e6a7617bbc82795b1f0c828a7721c213f4/chordnet.onnx"
    );
    assert!(
        model
            .path
            .ends_with(std::path::Path::new("chordmini-onnx/chordnet.onnx"))
    );
}

fn create_urls(files: &[&str]) -> FileUrls {
    let urls = files
        .iter()
        .map(|file| ((*file).to_owned(), format!("http://host/files/{file}")))
        .collect();
    FileUrls::create(urls)
}

fn describe_step(step: ProcessingStep) -> Option<Value> {
    let analysis = create_step(step, std::path::Path::new("/models"))?;
    let files = analysis
        .files
        .iter()
        .map(|model| model.file.as_str())
        .collect::<Vec<_>>();
    let urls = create_urls(&files);
    let request = (analysis.build)("http://host/pcm", &urls)
        .map_err(|_| "the request should be built")
        .expect("the request should be built");
    Some(json!({
        "api": analysis.api,
        "table": analysis.stored.table(),
        "mean": analysis.downmix == Downmix::Mean,
        "request": request,
    }))
}

#[test]
fn asks_the_browser_for_the_rhythm_it_stores_as_rhythm() {
    let described = describe_step(ProcessingStep::Rhythm);

    assert_eq!(
        described,
        Some(json!({
            "api": "musetricAiAnalyzeRhythm",
            "table": "Rhythm",
            "mean": true,
            "request": {
                "pcmUrl": "http://host/pcm",
                "modelUrl": "http://host/files/beat_this.onnx",
                "filterbankUrl": "http://host/files/mel-filterbank.bin",
            },
        }))
    );
}

#[test]
fn asks_the_browser_for_the_key_without_a_mean_downmix() {
    let described = describe_step(ProcessingStep::Key);

    assert_eq!(
        described,
        Some(json!({
            "api": "musetricAiAnalyzeKey",
            "table": "Key",
            "mean": false,
            "request": {
                "pcmUrl": "http://host/pcm",
                "modelUrl": "http://host/files/skey.onnx",
            },
        }))
    );
}

#[test]
fn leaves_the_remaining_steps_to_the_upstream_app() {
    assert!(describe_step(ProcessingStep::Chords).is_some());
    assert!(describe_step(ProcessingStep::Transcription).is_none());
    assert!(describe_step(ProcessingStep::Separation).is_none());
}
