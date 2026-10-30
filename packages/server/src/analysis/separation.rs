use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use musetric_db::{MasterType, NewStems, PendingJob, blob_path};
use musetric_jobs::{StepAnswer, StepPhase, StepReport};
use musetric_media::{Loudness, SampleRates, analyze_lead_visual_loudness, analyze_loudness};
use serde_json::json;
use uuid::Uuid;

use crate::{
    analysis::{
        AnalysisContext,
        browser::Failure,
        gains::{lead_loudness, plain_loudness},
        models::{VOCALS, VOCALS_MODEL, VOCALS_MODEL_DATA, vocals_graph},
        stage_attempt::{
            StageAttempt, StageInput, StageRun, StageStart, StepStems, UNIT_OUTPUT, cached_model,
            read_stage_input, run_step,
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

const LABEL: &str = "Headless stem separation";
const PASS: &str = "vocals";
const DSP_VERSION: &str = "separation-dsp-v2";
const UNSPLIT_FOLD: &str = "the folded units do not hold the vocals and the backing";

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
    separate_stems(running, job, stems).await?;
    (running.report)(StepPhase::Saving);
    let delivered = SampleRates {
        input: VOCALS.sample_rate,
        output: sample_rate,
    };
    tokio::try_join!(
        stems.vocals.encode(SampleRates {
            input: VOCALS.sample_rate,
            output: VOCALS.sample_rate,
        }),
        stems.instrumental.encode(delivered),
        stems.lead.encode(delivered),
        stems.backing.encode(delivered),
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
) -> Result<(), Failure> {
    let StageInput { models, pcm } =
        read_stage_input(running, job, &VOCALS.cached(&running.context.models_path)).await?;
    let mixture = Arc::new(normalize_peak(
        &planar_from_interleaved(&deinterleave(&pcm)),
        MAX_PEAK,
    ));
    let samples = u64::try_from(mixture.len() / CHANNELS).unwrap_or(0);
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
    attempt.close();
    let folded = outcome?;
    let (raw_vocals, raw_backing) = folded
        .split_at_checked(mixture.len())
        .filter(|(_, rest)| rest.len() == mixture.len())
        .ok_or_else(|| Failure::Refused(UNSPLIT_FOLD.to_owned()))?;
    let vocals = normalize_peak(raw_vocals, MAX_PEAK);
    let instrumental = normalize_peak(&subtract_planar(&mixture, raw_vocals), MAX_PEAK);
    let lead = normalize_peak(&subtract_planar(raw_vocals, raw_backing), MAX_PEAK);
    let backing = normalize_peak(raw_backing, MAX_PEAK);
    tokio::try_join!(
        stems.vocals.write_raw(&vocals),
        stems.instrumental.write_raw(&instrumental),
        stems.lead.write_raw(&lead),
        stems.backing.write_raw(&backing),
    )?;
    Ok(())
}

async fn produce(
    attempt: &mut StageAttempt<'_>,
    mixture: &Arc<Vec<f32>>,
    samples: u64,
    models: &[(String, PathBuf)],
) -> Result<Vec<f32>, Failure> {
    attempt.open().await?;
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
        "outputs": [UNIT_OUTPUT],
        "vocalsModelUrl": model,
        "vocalsModelDataUrl": model_data,
        "vocalsModelDataPath": VOCALS_MODEL_DATA,
        "graph": vocals_graph(),
    });
    let plan = UnitPlan::vocals(VOCALS.sample_rate, samples);
    let resume = attempt.resume(samples, plan.channels.output).await?;
    attempt
        .run(
            StageRegistration {
                attempt: attempt_id,
                plan,
                input: Arc::clone(mixture),
                outputs: vec![UNIT_OUTPUT.to_owned()],
                rules: PlanRules::VocalsV1,
                resume,
            },
            request,
        )
        .await
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
