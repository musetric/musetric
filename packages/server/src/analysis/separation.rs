use std::{
    fs::File,
    io::{BufWriter, Write},
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicU32, Ordering},
    },
};

use musetric_db::{MasterType, NewStems, PendingJob, blob_path};
use musetric_gpu::{
    ExecutorPhase, ExecutorSession, ExecutorSessionOptions, PhaseSink, UnitSession,
};
use musetric_jobs::{StepAnswer, StepPhase, StepReport};
use musetric_media::{Loudness, SampleRates, analyze_lead_visual_loudness, analyze_loudness};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::{
    analysis::{
        AnalysisContext,
        browser::{
            Failure, count_frames, decode_reporter, ensure_files, require_executor, show_phase,
        },
        gains::{lead_loudness, plain_loudness},
        models::VOCALS,
        separation_sink::{
            FRAME_BYTES, SeparationSink, SinkCheckpoint, SinkCursor, SinkOptions, SinkStem,
            truncate_stems,
        },
        stage_attempt::{StageRun, StepStems, cached_model, run_step},
        stem_files::{StemFiles, read_at},
    },
    blobs::StagedBlob,
    checkpoint::{CheckpointDir, area_root, computation_id, hex_digest, restore_refused},
    publish::publish,
    storage::{read_database, write_database},
};

const LABEL: &str = "Headless stem separation";
const API_NAME: &str = "musetricAiSeparate";
const PASS: &str = "vocals";
const CHECKPOINT_FORMAT: &str = "separation-stems-v1";
const MIXTURE_NAME: &str = "mixture.f32";
const MODEL: &str = "model";
const MODEL_DATA: &str = "modelData";
const MIXTURE_BUFFER_BYTES: usize = 1 << 20;
const STEREO: u64 = 2;
const NOT_ACTIVE: &str = "the attempt is not active";
const NO_AUDIO: &str = "The decoder produced no audio data";
const UNFINISHED: &str = "the separation answered before its stems covered the track";
const NO_SCALES: &str = "the separation answered without the scales of its stems";

struct Separated {
    vocals: StemFiles,
    instrumental: StemFiles,
    lead: StemFiles,
    backing: StemFiles,
}

impl StepStems for Separated {
    fn create(area: &Path, blobs_path: &Path) -> Self {
        Self {
            vocals: StemFiles::master(area, blobs_path, MasterType::Vocals),
            instrumental: StemFiles::delivered(area, blobs_path, MasterType::Instrumental),
            lead: StemFiles::delivered(area, blobs_path, MasterType::Lead),
            backing: StemFiles::delivered(area, blobs_path, MasterType::Backing),
        }
    }

    fn staged(&self) -> Vec<&StagedBlob> {
        [
            self.vocals.staged(),
            self.instrumental.staged(),
            self.lead.staged(),
            self.backing.staged(),
        ]
        .concat()
    }
}

impl Separated {
    fn sink_stems(&self) -> Vec<SinkStem> {
        [&self.vocals, &self.instrumental, &self.lead, &self.backing]
            .into_iter()
            .map(StemFiles::sink_stem)
            .collect()
    }
}

#[derive(Deserialize)]
struct StemScales {
    vocals: f64,
    instrumental: f64,
    lead: f64,
    backing: f64,
}

#[derive(Deserialize)]
struct SeparationAnswer {
    scales: StemScales,
}

struct Mixture {
    path: PathBuf,
    frames: u64,
    digest: String,
}

struct Resumed {
    cursor: SinkCursor,
    unit_count: u32,
    state: PathBuf,
}

struct SeparationJob<'job> {
    models: &'job [(String, PathBuf)],
    mixture: &'job Mixture,
    resumed: Option<&'job Resumed>,
    attempt: &'job str,
    unit_count: &'job AtomicU32,
}

pub(crate) async fn run(
    context: &AnalysisContext,
    job: &PendingJob,
    report: &StepReport,
) -> StepAnswer {
    run_step(context, job, report, separate).await
}

async fn separate(
    running: &StageRun<'_>,
    job: &PendingJob,
    stems: &Separated,
) -> Result<(), Failure> {
    let context = running.context;
    let sample_rate = running.project_sample_rate().await?;
    let source = blob_path(&context.storage.blobs_path, &job.blob_id);
    let source_analysis = async {
        analyze_loudness(context.storage.pcm.as_ref(), read_at(&source, sample_rate))
            .await
            .map_err(Failure::from)
    };
    let produced = process_stems(running, job, stems, sample_rate);
    let (source_loudness, ()) = tokio::try_join!(source_analysis, produced)?;
    store(running, stems, sample_rate, source_loudness).await
}

async fn process_stems(
    running: &StageRun<'_>,
    job: &PendingJob,
    stems: &Separated,
    sample_rate: u32,
) -> Result<(), Failure> {
    let scales = separate_stems(running, job, stems).await?;
    (running.report)(StepPhase::Saving);
    let model_rate = running.context.pins.separation.model.sample_rate;
    let delivered = SampleRates {
        input: model_rate,
        output: sample_rate,
    };
    tokio::try_join!(
        stems.vocals.encode(
            SampleRates {
                input: model_rate,
                output: model_rate,
            },
            scales.vocals,
        ),
        stems.instrumental.encode(delivered, scales.instrumental),
        stems.lead.encode(delivered, scales.lead),
        stems.backing.encode(delivered, scales.backing),
    )?;
    let pcm = running.context.storage.pcm.as_ref();
    tokio::try_join!(
        stems.instrumental.deliver(pcm, sample_rate),
        stems.lead.deliver(pcm, sample_rate),
        stems.backing.deliver(pcm, sample_rate),
    )?;
    Ok(())
}

async fn separate_stems(
    running: &StageRun<'_>,
    job: &PendingJob,
    stems: &Separated,
) -> Result<StemScales, Failure> {
    let context = running.context;
    let pin = &context.pins.separation;
    let cached = VOCALS.cached(&pin.model, &context.models_path);
    let models = ensure_files(context, running.report, &cached).await?;
    require_executor(context)?;
    let mixture = write_mixture(running, job, &running.area().join(MIXTURE_NAME)).await?;
    let computation = computation_id(&[
        CHECKPOINT_FORMAT,
        &mixture.digest,
        &pin.model.file(MODEL)?.sha256,
        &pin.model.file(MODEL_DATA)?.sha256,
    ]);
    let directory = CheckpointDir::create(area_root(
        &context.storage.work_path,
        running.project_id,
        running.step.name(),
        &computation,
    ));
    let sink_stems = stems.sink_stems();
    let resumed = read_resumed(running, &directory, &computation).await?;
    if let Some(found) = &resumed {
        truncate_stems(&sink_stems, found.cursor.frames)
            .await
            .map_err(|_| Failure::Refused(restore_refused("the stems are shorter than it")))?;
    }
    let attempt = Uuid::new_v4().to_string();
    let unit_count = Arc::new(AtomicU32::new(
        resumed.as_ref().map_or(0, |found| found.unit_count),
    ));
    let sink = Arc::new(SeparationSink::create(SinkOptions {
        checkpoint: SinkCheckpoint {
            storage: Arc::clone(&context.storage),
            directory,
            project_id: running.project_id,
            step: running.step,
            attempt: attempt.clone(),
            computation,
            pass: PASS,
        },
        stems: sink_stems,
        frames: mixture.frames,
        cursor: resumed.as_ref().map_or(
            SinkCursor {
                next_unit: 0,
                frames: 0,
            },
            |found| found.cursor,
        ),
        unit_count: Arc::clone(&unit_count),
    }));
    let (phases, mut reported) = mpsc::unbounded_channel();
    let on_phase: PhaseSink = Arc::new(move |phase| {
        let _ = phases.send(phase);
    });
    let session = context.host.open(ExecutorSessionOptions {
        label: LABEL.to_owned(),
        require_shader_f16: true,
        on_phase,
        units: Some(Arc::clone(&sink) as Arc<dyn UnitSession>),
    });
    let separation = SeparationJob {
        models: &models,
        mixture: &mixture,
        resumed: resumed.as_ref(),
        attempt: &attempt,
        unit_count: &unit_count,
    };
    let outcome = drive(running, &session, &separation, &mut reported).await;
    drop(session);
    let scales = outcome?;
    if sink.cursor()?.frames != mixture.frames {
        return Err(Failure::Refused(UNFINISHED.to_owned()));
    }
    Ok(scales)
}

async fn drive(
    running: &StageRun<'_>,
    session: &ExecutorSession,
    separation: &SeparationJob<'_>,
    reported: &mut mpsc::UnboundedReceiver<ExecutorPhase>,
) -> Result<StemScales, Failure> {
    let pin = &running.context.pins.separation;
    session.wait_ready().await?;
    (running.report)(StepPhase::Loading { progress: None });
    let model_name = &pin.model.file(MODEL)?.name;
    let model_data_name = &pin.model.file(MODEL_DATA)?.name;
    let model = session
        .register_file(&cached_model(separation.models, model_name)?)
        .await?;
    let model_data = session
        .register_file(&cached_model(separation.models, model_data_name)?)
        .await?;
    let mixture = session.register_file(&separation.mixture.path).await?;
    let mut request = json!({
        "attemptUrl": session.attempt_url(separation.attempt),
        "sampleRate": pin.model.sample_rate,
        "graph": pin.graph,
        "vocalsModelUrl": model,
        "vocalsModelDataUrl": model_data,
        "vocalsModelDataPath": model_data_name,
        "mixture": {
            "url": mixture,
            "frames": separation.mixture.frames,
        },
    });
    if let Some(found) = separation.resumed {
        request["stateUrl"] = json!(session.register_file(&found.state).await?);
    }
    bind(running, separation.attempt).await?;
    let ticket = session.send_job(API_NAME, &request)?;
    let mut answered = Box::pin(async move { ticket.wait().await });
    loop {
        tokio::select! {
            finished = &mut answered => {
                let value = finished.map_err(Failure::from)?;
                return serde_json::from_value::<SeparationAnswer>(value)
                    .map(|answer| answer.scales)
                    .map_err(|_| Failure::Refused(NO_SCALES.to_owned()));
            }
            Some(phase) = reported.recv() => {
                if let ExecutorPhase::Running { unit_count: count, .. } = phase {
                    separation.unit_count.store(count, Ordering::Relaxed);
                }
                show_phase(running.report, phase, None);
            }
        }
    }
}

async fn bind(running: &StageRun<'_>, attempt: &str) -> Result<(), Failure> {
    let project_id = running.project_id;
    let step = running.step;
    let attempt_id = attempt.to_owned();
    let bound = write_database(&running.context.storage, move |writer| {
        writer.bind_attempt(project_id, step, attempt_id)
    })
    .await?;
    if bound {
        Ok(())
    } else {
        Err(Failure::Refused(NOT_ACTIVE.to_owned()))
    }
}

async fn read_resumed(
    running: &StageRun<'_>,
    directory: &CheckpointDir,
    computation: &str,
) -> Result<Option<Resumed>, Failure> {
    let project_id = running.project_id;
    let step = running.step;
    let found = read_database(&running.context.storage, move |reader| {
        reader.step_checkpoint(project_id, step)
    })
    .await?;
    let Some(cursor) = found else {
        return Ok(None);
    };
    if cursor.computation_id.as_deref() != Some(computation)
        || cursor.pass.as_deref() != Some(PASS)
        || cursor.generation == 0
    {
        return Ok(None);
    }
    let tail = directory
        .read_tail(cursor.generation)
        .await
        .map_err(|_| Failure::Refused(restore_refused("the tail file is missing")))?;
    if Some(tail.digest.as_str()) != cursor.tail_hash.as_deref() {
        return Err(Failure::Refused(restore_refused(
            "the tail hash does not match",
        )));
    }
    Ok(Some(Resumed {
        cursor: SinkCursor {
            next_unit: cursor.next_unit,
            frames: u64::from(cursor.prefix_frames),
        },
        unit_count: cursor.unit_count,
        state: directory.tail_path(cursor.generation),
    }))
}

async fn write_mixture(
    running: &StageRun<'_>,
    job: &PendingJob,
    path: &Path,
) -> Result<Mixture, Failure> {
    let context = running.context;
    let sample_rate = context.pins.separation.model.sample_rate;
    let source = blob_path(&context.storage.blobs_path, &job.blob_id);
    let mut decoded = decode_reporter(running.report, count_frames(&source, sample_rate).await?);
    let file = File::create(path).map_err(|error| Failure::from(error.to_string()))?;
    let mut writer = BufWriter::with_capacity(MIXTURE_BUFFER_BYTES, file);
    let mut hasher = Sha256::new();
    let mut bytes = Vec::new();
    let mut samples = 0_u64;
    let mut written = Ok(());
    let mut sink = |chunk: &[f32]| {
        bytes.clear();
        bytes.extend(chunk.iter().flat_map(|sample| sample.to_le_bytes()));
        hasher.update(&bytes);
        if written.is_ok() {
            written = writer.write_all(&bytes);
        }
        samples += chunk.len() as u64;
        decoded(samples / STEREO);
    };
    context
        .storage
        .pcm
        .read_pcm(read_at(&source, sample_rate), &mut sink)
        .await?;
    written
        .and_then(|()| writer.flush())
        .map_err(|error| Failure::from(error.to_string()))?;
    let frames = samples / STEREO;
    if frames == 0 {
        return Err(Failure::Refused(NO_AUDIO.to_owned()));
    }
    debug_assert_eq!(samples * 4, frames * FRAME_BYTES);
    Ok(Mixture {
        path: path.to_owned(),
        frames,
        digest: hex_digest(hasher),
    })
}

async fn store(
    running: &StageRun<'_>,
    stems: &Separated,
    sample_rate: u32,
    source_loudness: Loudness,
) -> Result<(), Failure> {
    let context = running.context;
    let pcm = context.storage.pcm.as_ref();
    let (instrumental, lead, backing) = tokio::try_join!(
        analyze_loudness(pcm, read_at(stems.instrumental.master_path(), sample_rate)),
        analyze_lead_visual_loudness(pcm, read_at(stems.lead.master_path(), sample_rate)),
        analyze_loudness(pcm, read_at(stems.backing.master_path(), sample_rate)),
    )?;
    let separated = NewStems {
        project_id: running.project_id,
        loudness: vec![
            plain_loudness(MasterType::Source, source_loudness),
            plain_loudness(MasterType::Instrumental, instrumental),
            lead_loudness(&lead),
            plain_loudness(MasterType::Backing, backing),
        ],
        stems: vec![
            stems.vocals.recorded(),
            stems.instrumental.recorded(),
            stems.lead.recorded(),
            stems.backing.recorded(),
        ],
    };
    publish(&context.storage, &stems.staged(), move |writer| {
        writer.apply_stems_result(&separated)
    })
    .await?;
    Ok(())
}
