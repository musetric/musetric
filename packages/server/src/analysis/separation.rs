use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use musetric_db::{MasterType, NewStems, PendingJob, blob_path};
use musetric_jobs::{StepAnswer, StepPhase, StepReport};
use musetric_media::{Loudness, SampleRates, analyze_loudness, collect_interleaved_pcm};
use serde_json::json;
use uuid::Uuid;

use crate::{
    analysis::{
        AnalysisContext,
        browser::{Failure, count_frames, decode_reporter, ensure_files},
        gains::plain_loudness,
        models::{VOCALS, VOCALS_MODEL, VOCALS_MODEL_DATA, vocals_graph},
        stage_attempt::{
            StageAttempt, StageRun, StageStart, StepStems, UNIT_OUTPUT, cached_model, run_step,
        },
        stage_units::StageRegistration,
        stem_files::{StemFiles, read_at},
        stem_signal::{
            CHANNELS, MAX_PEAK, deinterleave, normalize_peak, planar_from_interleaved,
            subtract_planar,
        },
    },
    blobs::StagedBlob,
    checkpoint::{computation_id, digest_samples},
    publish::publish,
    unit_plan::{PlanRules, UnitPlan},
};

const LABEL: &str = "Headless vocals separation";
const PASS: &str = "vocals";
const DSP_VERSION: &str = "separation-dsp-v1";

struct Separated {
    vocals: StemFiles,
    instrumental: StemFiles,
}

impl StepStems for Separated {
    fn create(area: &Path, blobs_path: &Path) -> Self {
        Self {
            vocals: StemFiles::master(area, blobs_path, MasterType::Vocals),
            instrumental: StemFiles::delivered(area, blobs_path, MasterType::Instrumental),
        }
    }

    fn staged(&self) -> Vec<&StagedBlob> {
        [self.vocals.staged(), self.instrumental.staged()].concat()
    }
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
    separate_vocals(running, job, stems).await?;
    (running.report)(StepPhase::Saving);
    tokio::try_join!(
        stems.vocals.encode(SampleRates {
            input: VOCALS.sample_rate,
            output: VOCALS.sample_rate,
        }),
        stems.instrumental.encode(SampleRates {
            input: VOCALS.sample_rate,
            output: sample_rate,
        }),
    )?;
    stems
        .instrumental
        .deliver(running.context.storage.pcm.as_ref(), sample_rate)
        .await?;
    Ok(())
}

async fn separate_vocals(
    running: &StageRun<'_>,
    job: &PendingJob,
    stems: &Separated,
) -> Result<(), Failure> {
    let context = running.context;
    let report = running.report;
    let models = ensure_files(context, report, &VOCALS.cached(&context.models_path)).await?;
    let source = blob_path(&context.storage.blobs_path, &job.blob_id);
    let mut decoded = decode_reporter(report, count_frames(&source, VOCALS.sample_rate).await?);
    let pcm = collect_interleaved_pcm(
        context.storage.pcm.as_ref(),
        read_at(&source, VOCALS.sample_rate),
        &mut decoded,
    )
    .await?;
    let mixture = Arc::new(normalize_peak(
        &planar_from_interleaved(&deinterleave(&pcm)),
        MAX_PEAK,
    ));
    let samples = u64::try_from(mixture.len() / CHANNELS).unwrap_or(0);
    (report)(StepPhase::Loading);
    let computation = computation_id(&[
        DSP_VERSION,
        &digest_samples(&mixture),
        VOCALS.files[0].1,
        VOCALS.files[1].1,
    ]);
    let mut attempt = StageAttempt::start(
        running,
        StageStart {
            label: LABEL,
            pass: PASS,
            computation,
            input: &mixture,
        },
    )
    .await?;
    let outcome = produce(&mut attempt, &mixture, samples, &models).await;
    attempt.close().await;
    let raw_vocals = outcome?;
    let vocals = normalize_peak(&raw_vocals, MAX_PEAK);
    let instrumental = normalize_peak(&subtract_planar(&mixture, &raw_vocals), MAX_PEAK);
    tokio::try_join!(
        stems.vocals.write_raw(&vocals),
        stems.instrumental.write_raw(&instrumental),
    )?;
    Ok(())
}

async fn produce(
    attempt: &mut StageAttempt<'_>,
    mixture: &Arc<Vec<f32>>,
    samples: u64,
    models: &[(String, PathBuf)],
) -> Result<Vec<f32>, Failure> {
    let held = attempt.open().await?;
    let model = attempt
        .register(&cached_model(models, VOCALS_MODEL)?)
        .await?;
    let model_data = attempt
        .register(&cached_model(models, VOCALS_MODEL_DATA)?)
        .await?;
    let attempt_id = Uuid::new_v4().to_string();
    let request = json!({
        "attemptId": attempt_id,
        "attemptUrl": attempt.attempt_url(&attempt_id),
        "stage": "vocals",
        "outputs": [UNIT_OUTPUT],
        "vocalsModelUrl": model,
        "vocalsModelDataUrl": model_data,
        "vocalsModelDataPath": VOCALS_MODEL_DATA,
        "graph": vocals_graph(),
    });
    let resume = attempt.resume(samples, 2).await?;
    let outcome = attempt
        .run(
            StageRegistration {
                attempt: attempt_id,
                plan: UnitPlan::vocals(VOCALS.sample_rate, samples),
                input: Arc::clone(mixture),
                outputs: vec![UNIT_OUTPUT.to_owned()],
                rules: PlanRules::VocalsV1,
                resume,
            },
            request,
        )
        .await;
    drop(held);
    outcome
}

async fn store(
    running: &StageRun<'_>,
    stems: &Separated,
    sample_rate: u32,
    source_loudness: Loudness,
) -> Result<(), Failure> {
    let context = running.context;
    let instrumental = analyze_loudness(
        context.storage.pcm.as_ref(),
        read_at(stems.instrumental.master_path(), sample_rate),
    )
    .await?;
    let separated = NewStems {
        project_id: running.project_id,
        loudness: vec![
            plain_loudness(MasterType::Source, source_loudness),
            plain_loudness(MasterType::Instrumental, instrumental),
        ],
        stems: vec![stems.vocals.recorded(), stems.instrumental.recorded()],
    };
    publish(&context.storage, &stems.staged(), move |writer| {
        writer.apply_stems_result(&separated)
    })
    .await?;
    Ok(())
}
