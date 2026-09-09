use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use musetric_db::{MasterType, NewStems, PendingJob, blob_path};
use musetric_jobs::{StepAnswer, StepPhase, StepReport};
use musetric_media::{
    SampleRates, analyze_lead_visual_loudness, analyze_loudness, collect_interleaved_pcm,
};
use serde_json::json;
use uuid::Uuid;

use crate::{
    analysis::{
        AnalysisContext,
        browser::{Failure, count_frames, decode_reporter, ensure_files},
        gains::{lead_loudness, plain_loudness},
        models::{LEAD_BACKING, LEAD_BACKING_MODEL, VOCALS, lead_backing_graph},
        stage_attempt::{
            StageAttempt, StageRun, StageStart, StepStems, UNIT_OUTPUT, cached_model, run_step,
        },
        stage_units::StageRegistration,
        stem_files::{StemFiles, read_at},
        stem_signal::{
            CHANNELS, MAX_PEAK, apply_scale, crop, deinterleave, normalize_peak, peak_of,
            place_padded, planar_from_interleaved, residual,
        },
    },
    blobs::StagedBlob,
    checkpoint::{computation_id, digest_samples},
    publish::publish,
    unit_plan::{LEAD_BACKING_COMPENSATE, PlanRules, UnitPlan},
};

const LABEL: &str = "Headless lead and backing separation";
const PASS: &str = "leadBacking";
const DSP_VERSION: &str = "voices-dsp-v1";
const SILENT_VOCALS: &str = "The vocals signal appears to be silent";

struct Voices {
    lead: StemFiles,
    backing: StemFiles,
}

impl StepStems for Voices {
    fn create(area: &Path, blobs_path: &Path) -> Self {
        Self {
            lead: StemFiles::delivered(area, blobs_path, MasterType::Lead),
            backing: StemFiles::delivered(area, blobs_path, MasterType::Backing),
        }
    }

    fn staged(&self) -> Vec<&StagedBlob> {
        [self.lead.staged(), self.backing.staged()].concat()
    }
}

pub(crate) async fn run(
    context: &AnalysisContext,
    job: &PendingJob,
    report: &StepReport,
) -> StepAnswer {
    run_step(context, job, report, split).await
}

async fn split(running: &StageRun<'_>, job: &PendingJob, stems: &Voices) -> Result<(), Failure> {
    let context = running.context;
    let sample_rate = running.project_sample_rate().await?;
    split_voices(running, job, stems).await?;
    (running.report)(StepPhase::Saving);
    let rates = SampleRates {
        input: VOCALS.sample_rate,
        output: sample_rate,
    };
    tokio::try_join!(stems.lead.encode(rates), stems.backing.encode(rates))?;
    let pcm = context.storage.pcm.as_ref();
    tokio::try_join!(
        stems.lead.deliver(pcm, sample_rate),
        stems.backing.deliver(pcm, sample_rate),
    )?;
    store(running, stems, sample_rate).await
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "the padded vocals index an in-memory signal"
)]
async fn split_voices(
    running: &StageRun<'_>,
    job: &PendingJob,
    stems: &Voices,
) -> Result<(), Failure> {
    let context = running.context;
    let report = running.report;
    let models = ensure_files(context, report, &LEAD_BACKING.cached(&context.models_path)).await?;
    let source = blob_path(&context.storage.blobs_path, &job.blob_id);
    let mut decoded = decode_reporter(report, count_frames(&source, VOCALS.sample_rate).await?);
    let pcm = collect_interleaved_pcm(
        context.storage.pcm.as_ref(),
        read_at(&source, VOCALS.sample_rate),
        &mut decoded,
    )
    .await?;
    let vocals = planar_from_interleaved(&deinterleave(&pcm));
    let samples = u64::try_from(vocals.len() / CHANNELS).unwrap_or(0);
    (report)(StepPhase::Loading);
    let peak = peak_of(&vocals);
    if peak == 0.0 {
        return Err(Failure::Refused(SILENT_VOCALS.to_owned()));
    }
    let scaled = apply_scale(&vocals, 1.0 / peak);
    let (plan, layout) = UnitPlan::lead_backing(samples);
    let padded = Arc::new(place_padded(
        &scaled,
        layout.trim as usize,
        layout.mixture_samples as usize,
    ));
    let computation = computation_id(&[
        DSP_VERSION,
        &digest_samples(&padded),
        LEAD_BACKING.files[0].1,
    ]);
    let mut attempt = StageAttempt::start(
        running,
        StageStart {
            label: LABEL,
            pass: PASS,
            computation,
            input: &padded,
        },
    )
    .await?;
    let outcome = produce(&mut attempt, &padded, plan, &models).await;
    attempt.close().await;
    let folded = outcome?;
    let backing_norm = crop(&folded, layout.trim as usize, samples as usize);
    let backing = normalize_peak(&apply_scale(&backing_norm, peak), MAX_PEAK);
    let lead = normalize_peak(
        &residual(&scaled, &backing_norm, LEAD_BACKING_COMPENSATE, peak),
        MAX_PEAK,
    );
    tokio::try_join!(
        stems.lead.write_raw(&lead),
        stems.backing.write_raw(&backing),
    )?;
    Ok(())
}

async fn produce(
    attempt: &mut StageAttempt<'_>,
    padded: &Arc<Vec<f32>>,
    plan: UnitPlan,
    models: &[(String, PathBuf)],
) -> Result<Vec<f32>, Failure> {
    let held = attempt.open().await?;
    let model = attempt
        .register(&cached_model(models, LEAD_BACKING_MODEL)?)
        .await?;
    let attempt_id = Uuid::new_v4().to_string();
    let request = json!({
        "attemptId": attempt_id,
        "attemptUrl": attempt.attempt_url(&attempt_id),
        "stage": "leadBacking",
        "outputs": [UNIT_OUTPUT],
        "leadBackingModelUrl": model,
        "graph": lead_backing_graph(),
    });
    let frames = u64::try_from(padded.len() / CHANNELS).unwrap_or(0);
    let resume = attempt.resume(frames, 2).await?;
    let outcome = attempt
        .run(
            StageRegistration {
                attempt: attempt_id,
                plan,
                input: Arc::clone(padded),
                outputs: vec![UNIT_OUTPUT.to_owned()],
                rules: PlanRules::LeadBackingV1,
                resume,
            },
            request,
        )
        .await;
    drop(held);
    outcome
}

async fn store(running: &StageRun<'_>, stems: &Voices, sample_rate: u32) -> Result<(), Failure> {
    let context = running.context;
    let pcm = context.storage.pcm.as_ref();
    let (lead, backing) = tokio::try_join!(
        analyze_lead_visual_loudness(pcm, read_at(stems.lead.master_path(), sample_rate)),
        analyze_loudness(pcm, read_at(stems.backing.master_path(), sample_rate)),
    )?;
    let voices = NewStems {
        project_id: running.project_id,
        loudness: vec![
            lead_loudness(&lead),
            plain_loudness(MasterType::Backing, backing),
        ],
        stems: vec![stems.lead.recorded(), stems.backing.recorded()],
    };
    publish(&context.storage, &stems.staged(), move |writer| {
        writer.apply_stems_result(&voices)
    })
    .await?;
    Ok(())
}
