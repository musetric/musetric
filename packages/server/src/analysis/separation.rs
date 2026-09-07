use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use musetric_db::{NewSeparation, PendingJob, StemBlobs, blob_path};
use musetric_jobs::{StepAnswer, StepPhase, StepReport};
use musetric_media::{
    BoxedError, Loudness, PcmRequest, PcmSource, SampleRates, WavePeaks,
    analyze_lead_visual_loudness, analyze_loudness, collect_interleaved_pcm, convert_to_fmp4,
    encode_flac_from_raw, generate_wave_peaks, read_frame_count,
};
use serde_json::{Value, json};

use crate::{
    analysis::{
        AnalysisContext,
        browser::{
            Failure, Job, Session, SessionOptions, answer, count_frames, decode_reporter,
            ensure_files,
        },
        gains::{Stems, measure},
        models::{LEAD_BACKING, LEAD_BACKING_MODEL, VOCALS, VOCALS_MODEL, VOCALS_MODEL_DATA},
    },
    blobs::{StagedBlob, close_area, open_area, stage_blob, step_area},
    publish::publish,
    storage::read_database,
};

const LABEL: &str = "Headless AI separation";
const API_NAME: &str = "musetricAiSeparateAudio";
const RAW_SUFFIX: &str = "raw";
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

    fn each(&self) -> [&Stem; 3] {
        [&self.lead, &self.backing, &self.instrumental]
    }

    fn staged(&self) -> Vec<&StagedBlob> {
        self.each().into_iter().flat_map(Stem::staged).collect()
    }

    fn uploads(&self) -> HashMap<String, PathBuf> {
        STEMS
            .iter()
            .zip(self.each())
            .map(|(name, stem)| (format!("{name}.pcm"), stem.raw.clone()))
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

struct Run<'run> {
    context: &'run AnalysisContext,
    report: &'run StepReport,
    stems: &'run Separated,
}

pub(crate) async fn run(
    context: &AnalysisContext,
    job: &PendingJob,
    report: &StepReport,
) -> StepAnswer {
    let area = step_area(&context.storage.work_path, job.project_id, job.step);
    if let Err(error) = open_area(&area).await {
        return answer(Err(Failure::from(error.to_string())));
    }
    let stems = Separated::create(&area, &context.storage.blobs_path);
    let running = Run {
        context,
        report,
        stems: &stems,
    };
    let found = separate(&running, job).await;
    close_area(&area).await;
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
    split(running, job).await?;
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

struct Delivery<'delivery> {
    pcm: &'delivery dyn PcmSource,
    sample_rate: u32,
}

fn read_at(from: &Path, sample_rate: u32) -> PcmRequest<'_> {
    PcmRequest { from, sample_rate }
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

async fn split(running: &Run<'_>, job: &PendingJob) -> Result<(), Failure> {
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
    report(StepPhase::Loading);
    let mut session = Session::start(SessionOptions {
        label: LABEL,
        bundle: context.bundle.clone(),
        pcm,
        require_shader_f16: true,
    })
    .await?;
    let found = deliver(running, &mut session, &models).await;
    session.close().await;
    found
}

async fn deliver(
    running: &Run<'_>,
    session: &mut Session,
    models: &[(String, PathBuf)],
) -> Result<(), Failure> {
    let request = build_request(session, models).await?;
    let waiting = session.host().expect_uploads(running.stems.uploads())?;
    session
        .run(
            running.context.pages.as_ref(),
            Job {
                api: API_NAME,
                request: &request,
                report: running.report,
            },
        )
        .await?;
    waiting.wait().await?;
    Ok(())
}

async fn build_request(session: &Session, models: &[(String, PathBuf)]) -> Result<Value, Failure> {
    let host = session.host();
    let read = |name: &str| {
        models
            .iter()
            .find(|(file, _)| file == name)
            .map(|(_, path)| path.clone())
            .ok_or_else(|| Failure::Refused(format!("The model cache is missing {name}")))
    };
    Ok(json!({
        "pcmUrl": host.pcm_url(),
        "sampleRate": VOCALS.sample_rate,
        "vocalsModelUrl": host.register_file(&read(VOCALS_MODEL)?).await?,
        "vocalsModelDataUrl": host.register_file(&read(VOCALS_MODEL_DATA)?).await?,
        "vocalsModelDataPath": VOCALS_MODEL_DATA,
        "leadBackingModelUrl": host.register_file(&read(LEAD_BACKING_MODEL)?).await?,
    }))
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
    fn sends_every_stem_to_the_master_it_encodes() {
        let area = Path::new("/work/1/separation");
        let stems = Separated::create(area, Path::new("/blobs"));

        let uploads = stems.uploads();
        let masters = stems.blobs(|stem| &stem.master);
        let named = [
            ("lead.pcm", "lead", &stems.lead, masters.lead),
            ("backing.pcm", "backing", &stems.backing, masters.backing),
            (
                "instrumental.pcm",
                "instrumental",
                &stems.instrumental,
                masters.instrumental,
            ),
        ];
        for (upload, name, stem, blob_id) in named {
            assert_eq!(uploads.get(upload), Some(&stem.raw));
            assert_eq!(stem.raw, area.join(format!("{name}.{RAW_SUFFIX}")));
            assert_eq!(blob_id, stem.master.blob_id());
            assert_eq!(stem.master.path(), area.join(stem.master.blob_id()));
        }
        assert_eq!(uploads.len(), 3);
    }
}
