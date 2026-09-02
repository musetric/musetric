use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, post},
};
use musetric_db::{
    Analysis, MasterType, NewSeparation, PendingJob, ProcessingStep, StemBlobs, StemType,
};
use musetric_gpu::{Download, DownloadStatus, ExecutorFailure};
use musetric_jobs::StepAnswer;
use musetric_media::{Downmix, LeadVisualLoudness, Loudness};
use reqwest::Client;
use serde_json::{Value, json};
use tokio::fs::read_to_string;

use crate::{
    analysis::{
        AnalysisContext,
        browser::{BrowserAnalysis, HostedModel, Serve, answer, describe, store},
        gains::{Stems, measure},
        models::{CHORD_NET, CHORD_NET_MODEL, WHISPER},
        page::{PageFailure, close_page, open_page},
        steps::create as create_step,
    },
    proxy::ProxyState,
    storage::{read, write_database},
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

fn create_hosted(analysis: &BrowserAnalysis) -> HostedModel {
    if matches!(analysis.serve, Serve::Directory(_)) {
        return HostedModel::create(HashMap::new(), Some("http://host/models".to_owned()));
    }
    let urls = analysis
        .files
        .iter()
        .map(|model| {
            (
                model.file.clone(),
                format!("http://host/files/{}", model.file),
            )
        })
        .collect();
    HostedModel::create(urls, None)
}

fn describe_step(step: ProcessingStep) -> Option<Value> {
    let analysis = create_step(step, std::path::Path::new("/models"))?;
    let hosted = create_hosted(&analysis);
    let request = (analysis.build)("http://host/pcm", &hosted)
        .map_err(|_| "the request should be built")
        .expect("the request should be built");
    Some(json!({
        "api": analysis.api,
        "table": analysis.stored.table(),
        "mean": analysis.downmix == Downmix::Mean,
        "f16": analysis.require_shader_f16,
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
            "f16": false,
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
            "f16": false,
            "request": {
                "pcmUrl": "http://host/pcm",
                "modelUrl": "http://host/files/skey.onnx",
            },
        }))
    );
}

#[test]
fn points_the_transcription_at_the_whole_model_directory() {
    let described = describe_step(ProcessingStep::Transcription);

    assert_eq!(
        described,
        Some(json!({
            "api": "musetricAiTranscribeAudio",
            "table": "Subtitle",
            "mean": false,
            "f16": true,
            "request": {
                "pcmUrl": "http://host/pcm",
                "sampleRate": 16000,
                "modelHost": "http://host/models",
                "modelId": "musetric/whisper-large-v3-turbo-onnx",
                "revision": "da27c0c3e917574b5541f71251abfd2c1aabb3a1",
            },
        }))
    );
}

#[test]
fn caches_the_whisper_bundle_the_way_transformers_asks_for_it() {
    let files = WHISPER.cached(std::path::Path::new("/models"));

    let encoder = files
        .iter()
        .find(|file| file.file == "encoder_model_q4.onnx")
        .expect("the encoder should be listed");
    let hosted = encoder
        .path
        .strip_prefix(WHISPER.root(std::path::Path::new("/models")))
        .expect("the encoder should live under the served directory");
    assert_eq!(
        hosted,
        std::path::Path::new(
            "musetric/whisper-large-v3-turbo-onnx/resolve/da27c0c3e917574b5541f71251abfd2c1aabb3a1/encoder_model_q4.onnx"
        )
    );
}

#[test]
fn leaves_the_separation_to_the_upstream_app() {
    assert!(describe_step(ProcessingStep::Chords).is_some());
    assert!(describe_step(ProcessingStep::Separation).is_none());
}

const SEPARATION_PROJECT: &str = "
  INSERT INTO Project (id, name, sampleRate, frameCount)
  VALUES (2, 'Fixture project', 48000, 480000);
  INSERT INTO ProcessingError (projectId, step, message)
  VALUES (2, 'separation', 'Fixture failure');
";

fn create_loudness(integrated_loudness_db: f64, true_peak_db: f64) -> Loudness {
    Loudness {
        integrated_loudness_db,
        true_peak_db,
    }
}

fn create_stems(lead_integrated_loudness_db: f64) -> Stems {
    Stems {
        lead: LeadVisualLoudness {
            loudness: create_loudness(lead_integrated_loudness_db, -2.0),
            p95_rms_db: -30.0,
        },
        backing: create_loudness(-30.0, -4.0),
        instrumental: create_loudness(-8.0, -1.5),
    }
}

fn describe_gains(lead_integrated_loudness_db: f64) -> Value {
    let analysis = measure(
        create_loudness(-20.0, -3.0),
        &create_stems(lead_integrated_loudness_db),
    );
    json!({
        "source": analysis.source_gain_db,
        "spectrogram": analysis.lead_spectrogram_gain_db,
        "lead": analysis.lead_gain_db,
        "backing": analysis.backing_gain_db,
        "instrumental": analysis.instrumental_gain_db,
        "leadP95Rms": analysis.lead_p95_rms_db,
        "instrumentalLoudness": analysis.instrumental_integrated_loudness_db,
    })
}

#[test]
fn matches_the_gains_the_node_service_calculated() {
    let gains = describe_gains(-25.0);

    assert_eq!(
        gains,
        json!({
            "source": 2.0,
            "spectrogram": 5.0,
            "lead": 9.0,
            "backing": 9.0,
            "instrumental": -12.0,
            "leadP95Rms": -30.0,
            "instrumentalLoudness": -8.0,
        })
    );
}

#[test]
fn falls_back_to_the_source_gain_when_the_lead_is_silent() {
    let gains = describe_gains(-50.0);

    assert_eq!(gains["source"], json!(2.0));
    assert_eq!(gains["lead"], json!(2.0));
    assert_eq!(gains["backing"], json!(2.0));
    assert_eq!(gains["instrumental"], json!(2.0));
}

#[test]
fn leaves_a_step_pending_when_the_gpu_executor_disconnects() {
    let result = answer(Err(ExecutorFailure::Unavailable.into()));

    assert!(matches!(result, StepAnswer::Unavailable));
}

fn create_blobs(prefix: &str) -> StemBlobs {
    StemBlobs {
        lead: format!("{prefix}-lead"),
        backing: format!("{prefix}-backing"),
        instrumental: format!("{prefix}-instrumental"),
    }
}

#[tokio::test]
async fn records_every_stem_the_separation_produced() {
    let workspace = Workspace::new();
    workspace.seed(SEPARATION_PROJECT);
    let storage = workspace.create_storage();
    let separation = NewSeparation {
        project_id: 2,
        analysis: measure(create_loudness(-20.0, -3.0), &create_stems(-25.0)),
        master: create_blobs("master"),
        delivery: create_blobs("delivery"),
        wave_peaks: create_blobs("wave"),
    };

    write_database(&storage, move |writer| {
        writer.apply_separation_result(&separation)
    })
    .await
    .expect("the separation should be recorded");

    let recorded = read(&storage, |database| {
        let master = database.master_blob(2, MasterType::Backing)?;
        let delivery = database.delivery(2, StemType::Instrumental)?;
        let analysis = database.audio_analysis(2)?;
        let failures = database.step_failures(2)?;
        Ok((master, delivery, analysis, failures))
    })
    .await
    .expect("the separation should be read");
    let (master, delivery, analysis, failures) = recorded;
    assert_eq!(master.as_deref(), Some("master-backing"));
    let delivered = delivery.expect("the instrumental delivery should be recorded");
    assert_eq!(delivered.blob_id, "delivery-instrumental");
    assert_eq!(delivered.wave_blob_id, "wave-instrumental");
    assert_eq!(
        json!(
            analysis
                .expect("the audio analysis should be recorded")
                .source_gain_db
        ),
        json!(2.0)
    );
    assert!(failures.is_empty());
}
