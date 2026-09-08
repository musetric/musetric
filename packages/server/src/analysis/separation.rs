use std::{path::Path, path::PathBuf, sync::Arc};

use axum::body::Bytes;
use musetric_db::{
    CheckpointWrite, NewSeparation, PendingJob, ProcessingStep, StemBlobs, blob_path,
};
use musetric_gpu::{
    ExecutorFailure, ExecutorHost, ExecutorHostOptions, ExecutorPhase, PhaseSink, UnitSession,
};
use musetric_jobs::{StepAnswer, StepPass, StepPhase, StepReport};
use musetric_media::{
    BoxedError, Loudness, PcmRequest, PcmSource, SampleRates, WavePeaks,
    analyze_lead_visual_loudness, analyze_loudness, collect_interleaved_pcm, convert_to_fmp4,
    encode_flac_from_raw, generate_wave_peaks, read_frame_count,
};
use serde_json::{Value, json};
use tokio::{fs, sync::mpsc};
use uuid::Uuid;

use crate::{
    analysis::{
        AnalysisContext,
        browser::{Failure, answer, count_frames, decode_reporter, ensure_files, read_phase},
        gains::{Stems, measure},
        models::{LEAD_BACKING, LEAD_BACKING_MODEL, VOCALS, VOCALS_MODEL, VOCALS_MODEL_DATA},
        separation_units::{SeparationUnits, StageRegistration, StageResume},
        stem_signal::{
            CHANNELS, MAX_PEAK, apply_scale, crop, deinterleave, interleaved_from_planar,
            normalize_peak, peak_of, place_padded, planar_from_interleaved, residual,
            subtract_planar,
        },
    },
    blobs::{StagedBlob, close_area, ensure_area, stage_blob, step_area},
    checkpoint::{CheckpointDir, area_root, computation_id, digest_samples, restore_refused},
    pages::HeldPage,
    publish::publish,
    storage::{read_database, write_database},
    unit_fold::FoldAccumulator,
    unit_plan::{LEAD_BACKING_COMPENSATE, PlanRules, UnitPlan},
};

const LABEL: &str = "Headless AI separation";
const API_NAME: &str = "musetricAiSeparateUnits";
const UNIT_OUTPUT: &str = "separated";
const RAW_SUFFIX: &str = "raw";
const CHECKPOINT_EVERY: u32 = 2;
const VOCALS_PASS: &str = "vocals";
const LEAD_PASS: &str = "leadBacking";
const DSP_VERSION: &str = "separation-dsp-v1";
const STEMS: [&str; 3] = ["lead", "backing", "instrumental"];

struct Stem {
    master: StagedBlob,
    raw: PathBuf,
    delivery: StagedBlob,
    wave_peaks: StagedBlob,
}

impl Stem {
    fn create(area: &Path, blobs_path: &Path, name: &str) -> Self {
        Self {
            master: stage_blob(area, blobs_path),
            raw: area.join(format!("{name}.{RAW_SUFFIX}")),
            delivery: stage_blob(area, blobs_path),
            wave_peaks: stage_blob(area, blobs_path),
        }
    }

    fn staged(&self) -> [&StagedBlob; 3] {
        [&self.master, &self.delivery, &self.wave_peaks]
    }
}

struct Separated {
    lead: Stem,
    backing: Stem,
    instrumental: Stem,
}

impl Separated {
    fn create(area: &Path, blobs_path: &Path) -> Self {
        Self {
            lead: Stem::create(area, blobs_path, STEMS[0]),
            backing: Stem::create(area, blobs_path, STEMS[1]),
            instrumental: Stem::create(area, blobs_path, STEMS[2]),
        }
    }

    fn staged(&self) -> Vec<&StagedBlob> {
        [&self.lead, &self.backing, &self.instrumental]
            .into_iter()
            .flat_map(Stem::staged)
            .collect()
    }

    fn blobs(&self, read: fn(&Stem) -> &StagedBlob) -> StemBlobs {
        StemBlobs {
            lead: read(&self.lead).blob_id().to_owned(),
            backing: read(&self.backing).blob_id().to_owned(),
            instrumental: read(&self.instrumental).blob_id().to_owned(),
        }
    }
}

struct Produced {
    instrumental: Vec<f32>,
    lead: Vec<f32>,
    backing: Vec<f32>,
}

struct ModelUrls {
    vocals: String,
    vocals_data: String,
    lead_backing: String,
}

struct StageProgress {
    first: u32,
    total: u32,
}

struct Run<'run> {
    context: &'run AnalysisContext,
    report: &'run StepReport,
    stems: &'run Separated,
    project_id: i64,
    step: ProcessingStep,
}

type Reported = mpsc::UnboundedReceiver<ExecutorPhase>;

struct AttemptParts {
    units: Arc<SeparationUnits>,
    computation: String,
    store: CheckpointDir,
}

struct Attempt<'run> {
    running: &'run Run<'run>,
    host: ExecutorHost,
    units: Arc<SeparationUnits>,
    reported: Reported,
    computation: String,
    store: CheckpointDir,
    pass: &'static str,
}

impl<'run> Attempt<'run> {
    async fn create(running: &'run Run<'run>, parts: AttemptParts) -> Result<Self, Failure> {
        let units = &parts.units;
        let (phases, reported) = mpsc::unbounded_channel();
        let sink: PhaseSink = Arc::new(move |phase| {
            let _ = phases.send(phase);
        });
        let host = ExecutorHost::start(ExecutorHostOptions {
            label: LABEL.to_owned(),
            bundle: running.context.bundle.clone(),
            pcm: Bytes::from(Vec::new()),
            require_shader_f16: true,
            on_phase: sink,
            units: Some(Arc::clone(units) as Arc<dyn UnitSession>),
        })
        .await?;
        Ok(Self {
            running,
            host,
            units: parts.units,
            reported,
            computation: parts.computation,
            store: parts.store,
            pass: VOCALS_PASS,
        })
    }

    async fn close(self) {
        self.host.close().await;
    }

    async fn produce(
        &mut self,
        mixture: &Arc<Vec<f32>>,
        samples: u64,
        models: &[(String, PathBuf)],
    ) -> Result<Produced, Failure> {
        let page = self
            .running
            .context
            .pages
            .open_page(&self.host.page_url())
            .await?;
        let held = HeldPage::hold(self.running.context.pages.as_ref(), page);
        self.host.wait_ready().await?;
        let hosted = register_models(&self.host, models).await?;
        let outcome = self.stages(mixture, samples, &hosted).await;
        drop(held);
        outcome
    }

    #[expect(
        clippy::cast_possible_truncation,
        reason = "the padded mixture indexes in-memory stems"
    )]
    async fn stages(
        &mut self,
        mixture: &Arc<Vec<f32>>,
        samples: u64,
        hosted: &ModelUrls,
    ) -> Result<Produced, Failure> {
        let vocals_plan = UnitPlan::vocals(VOCALS.sample_rate, samples);
        let (lead_backing_plan, layout) = UnitPlan::lead_backing(samples);
        let vocals_units = vocals_plan.unit_count();
        let total = vocals_units + lead_backing_plan.unit_count();
        let vocals_id = Uuid::new_v4().to_string();
        let vocals_request = json!({
            "attemptId": vocals_id,
            "attemptUrl": self.host.attempt_url(&vocals_id),
            "stage": "vocals",
            "outputs": [UNIT_OUTPUT],
            "vocalsModelUrl": hosted.vocals,
            "vocalsModelDataUrl": hosted.vocals_data,
            "vocalsModelDataPath": VOCALS_MODEL_DATA,
        });
        self.pass = VOCALS_PASS;
        let vocals_resume = self.resume_fold(samples, 2).await?;
        self.stage(
            StageRegistration {
                attempt: vocals_id.clone(),
                plan: vocals_plan,
                input: Arc::clone(mixture),
                outputs: vec![UNIT_OUTPUT.to_owned()],
                rules: PlanRules::VocalsV1,
                resume: vocals_resume,
            },
            vocals_request,
            StageProgress { first: 0, total },
        )
        .await?;
        let raw_vocals = self.units.finalize(&vocals_id)?;
        self.store
            .write_vocals(&raw_vocals)
            .await
            .map_err(|error| Failure::from(error.to_string()))?;
        let vocals = normalize_peak(&raw_vocals, MAX_PEAK);
        let instrumental = normalize_peak(&subtract_planar(mixture, &raw_vocals), MAX_PEAK);

        let peak = peak_of(&vocals);
        if peak == 0.0 {
            return Err(Failure::Refused(
                "The vocals signal appears to be silent".to_owned(),
            ));
        }
        let scaled = apply_scale(&vocals, 1.0 / peak);
        let padded = Arc::new(place_padded(
            &scaled,
            layout.trim as usize,
            layout.mixture_samples as usize,
        ));
        let lead_backing_id = Uuid::new_v4().to_string();
        let lead_backing_request = json!({
            "attemptId": lead_backing_id,
            "attemptUrl": self.host.attempt_url(&lead_backing_id),
            "stage": "leadBacking",
            "outputs": [UNIT_OUTPUT],
            "leadBackingModelUrl": hosted.lead_backing,
        });
        self.pass = LEAD_PASS;
        let lead_resume = self
            .resume_fold(u64::try_from(padded.len() / CHANNELS).unwrap_or(0), 2)
            .await?;
        self.stage(
            StageRegistration {
                attempt: lead_backing_id.clone(),
                plan: lead_backing_plan,
                input: Arc::clone(&padded),
                outputs: vec![UNIT_OUTPUT.to_owned()],
                rules: PlanRules::LeadBackingV1,
                resume: lead_resume,
            },
            lead_backing_request,
            StageProgress {
                first: vocals_units,
                total,
            },
        )
        .await?;
        let folded = self.units.finalize(&lead_backing_id)?;
        let backing_norm = crop(&folded, layout.trim as usize, samples as usize);
        let backing = normalize_peak(&apply_scale(&backing_norm, peak), MAX_PEAK);
        let lead = normalize_peak(
            &residual(&scaled, &backing_norm, LEAD_BACKING_COMPENSATE, peak),
            MAX_PEAK,
        );
        Ok(Produced {
            instrumental,
            lead,
            backing,
        })
    }

    async fn stage(
        &mut self,
        registration: StageRegistration,
        request: Value,
        progress: StageProgress,
    ) -> Result<(), Failure> {
        let count = registration.plan.unit_count();
        let attempt_id = registration.attempt.clone();
        self.units.register(registration)?;
        self.bind(&attempt_id).await?;
        let start = self.units.next_unit(&attempt_id)?;
        let ticket = self.host.send_job(API_NAME, &request)?;
        let mut answered = Box::pin(async move { ticket.wait().await });
        tokio::select! {
            finished = &mut answered => return early_job(finished),
            outcome = self.units.wait_opened(&attempt_id) => outcome?,
        }
        for index in start..count {
            (self.running.report)(StepPhase::Running {
                pass: StepPass::Decode,
                unit: progress.first + index,
                unit_count: progress.total,
            });
            self.host.send_unit(&attempt_id, index, count)?;
            self.drain_phases();
            tokio::select! {
                finished = &mut answered => return early_job(finished),
                outcome = self.units.folded(&attempt_id, index) => outcome?,
            }
            self.persist(&attempt_id, index + 1, count).await?;
        }
        self.host.send_unit_close(&attempt_id)?;
        loop {
            tokio::select! {
                finished = &mut answered => {
                    finished.map_err(Failure::from)?;
                    return Ok(());
                }
                received = self.reported.recv() => {
                    if let Some(phase) = received {
                        (self.running.report)(read_phase(phase));
                    }
                }
            }
        }
    }

    fn drain_phases(&mut self) {
        while let Ok(phase) = self.reported.try_recv() {
            (self.running.report)(read_phase(phase));
        }
    }

    async fn bind(&self, attempt: &str) -> Result<(), Failure> {
        let project_id = self.running.project_id;
        let step = self.running.step;
        let attempt_id = attempt.to_owned();
        let bound = write_database(&self.running.context.storage, move |writer| {
            writer.bind_attempt(project_id, step, attempt_id)
        })
        .await?;
        if bound {
            Ok(())
        } else {
            Err(Failure::Refused("the attempt is not active".to_owned()))
        }
    }

    async fn persist(&self, attempt: &str, next_unit: u32, count: u32) -> Result<(), Failure> {
        if next_unit != count && !next_unit.is_multiple_of(CHECKPOINT_EVERY) {
            return Ok(());
        }
        let bytes = self.units.snapshot(attempt)?;
        let previous = read_database(&self.running.context.storage, {
            let project_id = self.running.project_id;
            let step = self.running.step;
            move |reader| reader.step_checkpoint(project_id, step)
        })
        .await?
        .map_or(0, |cursor| cursor.generation);
        let generation = previous + 1;
        let stored = self
            .store
            .write_tail(generation, &bytes)
            .await
            .map_err(|error| Failure::from(error.to_string()))?;
        let committed = write_database(&self.running.context.storage, {
            let write = CheckpointWrite {
                project_id: self.running.project_id,
                step: self.running.step,
                attempt_id: attempt.to_owned(),
                computation_id: self.computation.clone(),
                generation,
                pass: self.pass.to_owned(),
                next_unit,
                unit_count: count,
                prefix_frames: 0,
                tail_hash: stored.digest,
                tail_bytes: i64::try_from(stored.bytes.len()).unwrap_or(0),
            };
            move |writer| writer.commit_checkpoint(&write)
        })
        .await?;
        if !committed {
            return Err(Failure::Refused("the attempt is not active".to_owned()));
        }
        if previous > 0 {
            self.store.discard(previous).await;
        }
        Ok(())
    }

    async fn resume_fold(
        &self,
        frames: u64,
        channels: u32,
    ) -> Result<Option<StageResume>, Failure> {
        let project_id = self.running.project_id;
        let step = self.running.step;
        let found = read_database(&self.running.context.storage, move |reader| {
            reader.step_checkpoint(project_id, step)
        })
        .await?;
        let Some(cursor) = found else {
            return Ok(None);
        };
        if cursor.computation_id.as_deref() != Some(self.computation.as_str())
            || cursor.pass.as_deref() != Some(self.pass)
            || cursor.generation == 0
        {
            return Ok(None);
        }
        let tail = self
            .store
            .read_tail(cursor.generation)
            .await
            .map_err(|_| Failure::Refused(restore_refused("the tail file is missing")))?;
        if Some(tail.digest.as_str()) != cursor.tail_hash.as_deref() {
            return Err(Failure::Refused(restore_refused(
                "the tail hash does not match",
            )));
        }
        let fold = FoldAccumulator::from_bytes(&tail.bytes, frames, channels)
            .ok_or_else(|| Failure::Refused(restore_refused("the tail is not a fold")))?;
        Ok(Some(StageResume {
            fold,
            next_unit: cursor.next_unit,
        }))
    }
}

fn early_job(finished: Result<Value, ExecutorFailure>) -> Result<(), Failure> {
    finished.map_err(Failure::from)?;
    Err(Failure::Refused(
        "the separation job answered before the close".to_owned(),
    ))
}

async fn register_models(
    host: &ExecutorHost,
    models: &[(String, PathBuf)],
) -> Result<ModelUrls, Failure> {
    let cached = |name: &str| {
        models
            .iter()
            .find(|(file, _)| file == name)
            .map(|(_, path)| path.clone())
            .ok_or_else(|| Failure::Refused(format!("The model cache is missing {name}")))
    };
    Ok(ModelUrls {
        vocals: host.register_file(&cached(VOCALS_MODEL)?).await?,
        vocals_data: host.register_file(&cached(VOCALS_MODEL_DATA)?).await?,
        lead_backing: host.register_file(&cached(LEAD_BACKING_MODEL)?).await?,
    })
}

pub(crate) async fn run(
    context: &AnalysisContext,
    job: &PendingJob,
    report: &StepReport,
) -> StepAnswer {
    let area = step_area(&context.storage.work_path, job.project_id, job.step);
    if let Err(error) = ensure_area(&area).await {
        return answer(Err(Failure::from(error.to_string())));
    }
    let stems = Separated::create(&area, &context.storage.blobs_path);
    let running = Run {
        context,
        report,
        stems: &stems,
        project_id: job.project_id,
        step: job.step,
    };
    let found = separate(&running, job).await;
    if found.is_ok() {
        close_area(&area).await;
    }
    answer(found)
}

async fn separate(running: &Run<'_>, job: &PendingJob) -> Result<(), Failure> {
    let context = running.context;
    let sample_rate = read_sample_rate(context, job.project_id).await?;
    let source = blob_path(&context.storage.blobs_path, &job.blob_id);
    let source_analysis = async {
        analyze_loudness(context.storage.pcm.as_ref(), read_at(&source, sample_rate))
            .await
            .map_err(Failure::from)
    };
    let stems = process_stems(running, job, sample_rate);
    let (source_loudness, ()) = tokio::try_join!(source_analysis, stems)?;
    store(running, job, sample_rate, source_loudness).await?;
    Ok(())
}

async fn process_stems(
    running: &Run<'_>,
    job: &PendingJob,
    sample_rate: u32,
) -> Result<(), Failure> {
    let context = running.context;
    separate_units(running, job).await?;
    (running.report)(StepPhase::Saving);
    let stems = running.stems;
    let rates = SampleRates {
        input: VOCALS.sample_rate,
        output: sample_rate,
    };
    tokio::try_join!(
        encode_flac_from_raw(&stems.lead.raw, stems.lead.master.path(), rates),
        encode_flac_from_raw(&stems.backing.raw, stems.backing.master.path(), rates),
        encode_flac_from_raw(
            &stems.instrumental.raw,
            stems.instrumental.master.path(),
            rates
        ),
    )?;
    let delivery = Delivery {
        pcm: context.storage.pcm.as_ref(),
        sample_rate,
    };
    tokio::try_join!(
        deliver_stem(&delivery, &stems.lead),
        deliver_stem(&delivery, &stems.backing),
        deliver_stem(&delivery, &stems.instrumental),
    )?;
    Ok(())
}

async fn separate_units(running: &Run<'_>, job: &PendingJob) -> Result<(), Failure> {
    let context = running.context;
    let report = running.report;
    let mut models = ensure_files(context, report, &VOCALS.cached(&context.models_path)).await?;
    models.extend(ensure_files(context, report, &LEAD_BACKING.cached(&context.models_path)).await?);
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
    let samples = (mixture.len() / CHANNELS) as u64;
    (report)(StepPhase::Loading);
    let computation = computation_id(&[
        DSP_VERSION,
        &digest_samples(&mixture),
        VOCALS.files[0].1,
        VOCALS.files[1].1,
        LEAD_BACKING.files[0].1,
    ]);
    let store = CheckpointDir::create(area_root(
        &context.storage.work_path,
        job.project_id,
        job.step.name(),
        &computation,
    ));
    store
        .write_mixture(&mixture)
        .await
        .map_err(|error| Failure::from(error.to_string()))?;
    store
        .write_input(&mixture)
        .await
        .map_err(|error| Failure::from(error.to_string()))?;
    let units = Arc::new(SeparationUnits::create(store.incoming_root()));
    let mut attempt = Attempt::create(
        running,
        AttemptParts {
            units,
            computation,
            store,
        },
    )
    .await?;
    let outcome = attempt.produce(&mixture, samples, &models).await;
    attempt.close().await;
    let produced = outcome?;
    write_stems(running.stems, &produced).await?;
    Ok(())
}

struct Delivery<'delivery> {
    pcm: &'delivery dyn PcmSource,
    sample_rate: u32,
}

fn read_at(from: &Path, sample_rate: u32) -> PcmRequest<'_> {
    PcmRequest { from, sample_rate }
}

async fn write_stems(stems: &Separated, produced: &Produced) -> Result<(), Failure> {
    tokio::try_join!(
        write_raw(&stems.instrumental.raw, &produced.instrumental),
        write_raw(&stems.lead.raw, &produced.lead),
        write_raw(&stems.backing.raw, &produced.backing),
    )?;
    Ok(())
}

async fn write_raw(path: &Path, planar: &[f32]) -> Result<(), Failure> {
    if let Some(directory) = path.parent() {
        fs::create_dir_all(directory)
            .await
            .map_err(|error| Failure::from(error.to_string()))?;
    }
    fs::write(path, interleaved_from_planar(planar))
        .await
        .map_err(|error| Failure::from(error.to_string()))
}

async fn deliver_stem(delivery: &Delivery<'_>, stem: &Stem) -> Result<(), BoxedError> {
    let sample_rate = delivery.sample_rate;
    convert_to_fmp4(
        delivery.pcm,
        read_at(stem.master.path(), sample_rate),
        stem.delivery.path(),
    )
    .await?;
    let request = WavePeaks {
        source: read_at(stem.master.path(), sample_rate),
        to: stem.wave_peaks.path(),
        total_frames: read_frame_count(stem.master.path()).await?,
    };
    generate_wave_peaks(delivery.pcm, &request).await
}

async fn store(
    running: &Run<'_>,
    job: &PendingJob,
    sample_rate: u32,
    source_loudness: Loudness,
) -> Result<(), Failure> {
    let context = running.context;
    let pcm = context.storage.pcm.as_ref();
    let stems = running.stems;
    let (lead, backing, instrumental) = tokio::try_join!(
        analyze_lead_visual_loudness(pcm, read_at(stems.lead.master.path(), sample_rate)),
        analyze_loudness(pcm, read_at(stems.backing.master.path(), sample_rate)),
        analyze_loudness(pcm, read_at(stems.instrumental.master.path(), sample_rate)),
    )?;
    let loudness = measure(
        source_loudness,
        &Stems {
            lead,
            backing,
            instrumental,
        },
    );
    let separation = NewSeparation {
        project_id: job.project_id,
        loudness,
        master: stems.blobs(|stem| &stem.master),
        delivery: stems.blobs(|stem| &stem.delivery),
        wave_peaks: stems.blobs(|stem| &stem.wave_peaks),
    };
    publish(&context.storage, &stems.staged(), move |writer| {
        writer.apply_separation_result(&separation)
    })
    .await?;
    Ok(())
}

async fn read_sample_rate(context: &AnalysisContext, project_id: i64) -> Result<u32, Failure> {
    let found = read_database(&context.storage, move |database| {
        database.project(project_id)
    })
    .await?;
    let project =
        found.ok_or_else(|| Failure::Refused(format!("Project with id {project_id} not found")))?;
    u32::try_from(project.sample_rate)
        .map_err(|_| Failure::Refused("The project sample rate is out of range".to_owned()))
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{RAW_SUFFIX, Separated};

    #[test]
    fn stores_every_stem_next_to_the_master_it_encodes() {
        let area = Path::new("/work/1/separation");
        let stems = Separated::create(area, Path::new("/blobs"));

        let masters = [
            ("lead", &stems.lead),
            ("backing", &stems.backing),
            ("instrumental", &stems.instrumental),
        ];
        for (name, stem) in masters {
            assert_eq!(stem.raw, area.join(format!("{name}.{RAW_SUFFIX}")));
            assert_eq!(stem.master.path(), area.join(stem.master.blob_id()));
        }
    }
}
