use std::{collections::HashMap, sync::Arc};

use musetric_db::{
    Analysis, MasterType, NewDelivery, NewStem, NewStems, PendingJob, ProcessingStep, StemLoudness,
    StemType,
};
use musetric_gpu::{Bundle, Download, DownloadStatus, ExecutorFailure};
use musetric_jobs::StepAnswer;
use musetric_media::{Downmix, LeadVisualLoudness, Loudness};
use reqwest::Client;
use serde_json::{Value, json};
use tokio::fs::read_to_string;

use crate::{
    analysis::{
        AnalysisContext,
        browser::{BrowserAnalysis, HostedModel, Serve, answer, describe, store},
        gains::{lead_loudness, plain_loudness, read_gains},
        models::{CHORD_NET, CHORD_NET_MODEL, WHISPER},
        steps::create as create_step,
    },
    page_bridge::PageBridge,
    storage::{Storage, read, write_database},
    test_workspace::Workspace,
};

const CREATE_PROJECT: &str = "
  INSERT INTO Project (id, name, sampleRate, frameCount)
  VALUES (1, 'Fixture project', 48000, 480000);
";

fn create_context(workspace: &Workspace) -> AnalysisContext {
    AnalysisContext {
        storage: workspace.create_storage(),
        pages: PageBridge::create(),
        client: Client::new(),
        models_path: workspace.blobs_path().join("models"),
        bundle: Bundle::Directory(workspace.blobs_path().join("bundle")),
    }
}

#[tokio::test]
async fn stores_the_chords_the_executor_answered() {
    let workspace = Workspace::new();
    workspace.seed(CREATE_PROJECT);
    let context = create_context(&workspace);
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
    let request = (analysis.build)("attempt-1", "http://host/attempt/attempt-1", &hosted)
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
                "attemptId": "attempt-1",
                "attemptUrl": "http://host/attempt/attempt-1",
                "outputs": ["result"],
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
                "attemptId": "attempt-1",
                "attemptUrl": "http://host/attempt/attempt-1",
                "outputs": ["result"],
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
                "attemptId": "attempt-1",
                "attemptUrl": "http://host/attempt/attempt-1",
                "outputs": ["result"],
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
fn keeps_the_stem_steps_out_of_the_step_table() {
    assert!(describe_step(ProcessingStep::Chords).is_some());
    assert!(describe_step(ProcessingStep::Separation).is_none());
    assert!(describe_step(ProcessingStep::Voices).is_none());
}

const SEPARATION_PROJECT: &str = "
  INSERT INTO Project (id, name, sampleRate, frameCount)
  VALUES (2, 'Fixture project', 48000, 480000);
";

fn create_loudness(integrated_loudness_db: f64, true_peak_db: f64) -> Loudness {
    Loudness {
        integrated_loudness_db,
        true_peak_db,
    }
}

fn separation_loudness() -> Vec<StemLoudness> {
    vec![
        plain_loudness(MasterType::Source, create_loudness(-20.0, -3.0)),
        plain_loudness(MasterType::Instrumental, create_loudness(-8.0, -1.5)),
    ]
}

fn voices_loudness(lead_integrated_loudness_db: f64) -> Vec<StemLoudness> {
    vec![
        lead_loudness(&LeadVisualLoudness {
            loudness: create_loudness(lead_integrated_loudness_db, -2.0),
            p95_rms_db: -30.0,
        }),
        plain_loudness(MasterType::Backing, create_loudness(-30.0, -4.0)),
    ]
}

fn measure_stems(lead_integrated_loudness_db: f64) -> Vec<StemLoudness> {
    let mut measured = separation_loudness();
    measured.extend(voices_loudness(lead_integrated_loudness_db));
    measured
}

fn find_stem(measured: &[StemLoudness], stem: MasterType) -> &StemLoudness {
    measured
        .iter()
        .find(|row| row.stem == stem)
        .expect("the stem should be measured")
}

fn describe_gains(lead_integrated_loudness_db: f64) -> Value {
    let measured = measure_stems(lead_integrated_loudness_db);
    let gains = read_gains(&measured).expect("every stem should be measured");
    json!({
        "source": gains.source,
        "spectrogram": gains.lead_spectrogram,
        "lead": gains.lead,
        "backing": gains.backing,
        "instrumental": gains.instrumental,
        "leadP95Rms": find_stem(&measured, MasterType::Lead).p95_rms_db,
        "instrumentalLoudness": find_stem(&measured, MasterType::Instrumental).integrated_lufs,
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

fn create_stem(stem: MasterType, delivered: bool) -> NewStem {
    let name = stem.name();
    NewStem {
        stem,
        master_blob_id: format!("master-{name}"),
        delivery: delivered.then(|| NewDelivery {
            blob_id: format!("delivery-{name}"),
            wave_blob_id: format!("wave-{name}"),
        }),
    }
}

async fn record_stems(storage: &Arc<Storage>, loudness: Vec<StemLoudness>, stems: Vec<NewStem>) {
    let recorded = NewStems {
        project_id: 2,
        loudness,
        stems,
    };
    write_database(storage, move |writer| writer.apply_stems_result(&recorded))
        .await
        .expect("the stems should be recorded");
}

async fn record_separation(storage: &Arc<Storage>) {
    record_stems(
        storage,
        separation_loudness(),
        vec![
            create_stem(MasterType::Vocals, false),
            create_stem(MasterType::Instrumental, true),
        ],
    )
    .await;
}

#[tokio::test]
async fn records_the_stems_of_both_separation_steps() {
    let workspace = Workspace::new();
    workspace.seed(SEPARATION_PROJECT);
    let storage = workspace.create_storage();
    record_separation(&storage).await;
    record_stems(
        &storage,
        voices_loudness(-25.0),
        vec![
            create_stem(MasterType::Lead, true),
            create_stem(MasterType::Backing, true),
        ],
    )
    .await;

    let recorded = read(&storage, |database| {
        let vocals = database.master_blob(2, MasterType::Vocals)?;
        let backing = database.master_blob(2, MasterType::Backing)?;
        let instrumental = database.delivery(2, StemType::Instrumental)?;
        let lead = database.delivery(2, StemType::Lead)?;
        let measured = database.stem_loudness(2)?;
        Ok((vocals, backing, instrumental, lead, measured))
    })
    .await
    .expect("the stems should be read");
    let (vocals, backing, instrumental, lead, measured) = recorded;
    assert_eq!(vocals.as_deref(), Some("master-vocals"));
    assert_eq!(backing.as_deref(), Some("master-backing"));
    let delivered = instrumental.expect("the instrumental delivery should be recorded");
    assert_eq!(delivered.blob_id, "delivery-instrumental");
    assert_eq!(delivered.wave_blob_id, "wave-instrumental");
    assert!(lead.is_some());
    let gains = read_gains(&measured).expect("every stem should be recorded");
    assert_eq!(json!(gains.source), json!(2.0));
    assert_eq!(
        json!(find_stem(&measured, MasterType::Lead).p95_rms_db),
        json!(-30.0)
    );
}

#[tokio::test]
async fn keeps_the_instrumental_when_the_voices_step_runs_again() {
    let workspace = Workspace::new();
    workspace.seed(SEPARATION_PROJECT);
    let storage = workspace.create_storage();
    record_separation(&storage).await;

    record_stems(
        &storage,
        voices_loudness(-25.0),
        vec![NewStem {
            stem: MasterType::Lead,
            master_blob_id: "retried-lead".to_owned(),
            delivery: Some(NewDelivery {
                blob_id: "retried-delivery-lead".to_owned(),
                wave_blob_id: "retried-wave-lead".to_owned(),
            }),
        }],
    )
    .await;

    let recorded = read(&storage, |database| {
        let instrumental = database.master_blob(2, MasterType::Instrumental)?;
        let vocals = database.master_blob(2, MasterType::Vocals)?;
        let lead = database.master_blob(2, MasterType::Lead)?;
        Ok((instrumental, vocals, lead))
    })
    .await
    .expect("the stems should be read");
    let (instrumental, vocals, lead) = recorded;
    assert_eq!(instrumental.as_deref(), Some("master-instrumental"));
    assert_eq!(vocals.as_deref(), Some("master-vocals"));
    assert_eq!(lead.as_deref(), Some("retried-lead"));
}
