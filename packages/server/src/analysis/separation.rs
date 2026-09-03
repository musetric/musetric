use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use musetric_db::{NewSeparation, PendingJob, StemBlobs, blob_path};
use musetric_jobs::{StepAnswer, StepEvent, StepReport};
use musetric_media::{
    BoxedError, Loudness, PcmRequest, PcmSource, SampleRates, WavePeaks,
    analyze_lead_visual_loudness, analyze_loudness, collect_interleaved_pcm, convert_to_fmp4,
    encode_flac_from_raw, generate_wave_peaks, read_frame_count,
};
use serde_json::{Value, json};
use tokio::fs::remove_file;

use crate::{
    analysis::{
        AnalysisContext,
        browser::{Failure, Job, Session, SessionOptions, answer, ensure_files},
        gains::{Stems, measure},
        models::{LEAD_BACKING, LEAD_BACKING_MODEL, VOCALS, VOCALS_MODEL, VOCALS_MODEL_DATA},
    },
    blobs::{BlobRef, create_blob_ref},
    storage::{read_database, write_database},
};

const LABEL: &str = "Headless AI separation";
const API_NAME: &str = "musetricAiSeparateAudio";
const RAW_SUFFIX: &str = "raw";
const STEMS: [&str; 3] = ["lead", "backing", "instrumental"];

struct Stem {
    master: BlobRef,
    raw: PathBuf,
    delivery: BlobRef,
    wave_peaks: BlobRef,
}

impl Stem {
    fn create(blobs_path: &Path) -> Self {
        let master = create_blob_ref(blobs_path);
        let raw = master.path.with_extension(RAW_SUFFIX);
        Self {
            master,
            raw,
            delivery: create_blob_ref(blobs_path),
            wave_peaks: create_blob_ref(blobs_path),
        }
    }
}

struct Separated {
    lead: Stem,
    backing: Stem,
    instrumental: Stem,
}

impl Separated {
    fn create(blobs_path: &Path) -> Self {
        Self {
            lead: Stem::create(blobs_path),
            backing: Stem::create(blobs_path),
            instrumental: Stem::create(blobs_path),
        }
    }

    fn each(&self) -> [&Stem; 3] {
        [&self.lead, &self.backing, &self.instrumental]
    }

    fn uploads(&self) -> HashMap<String, PathBuf> {
        STEMS
            .iter()
            .zip(self.each())
            .map(|(name, stem)| (format!("{name}.pcm"), stem.raw.clone()))
            .collect()
    }

    fn blobs(&self, read: fn(&Stem) -> &BlobRef) -> StemBlobs {
        StemBlobs {
            lead: read(&self.lead).blob_id.clone(),
            backing: read(&self.backing).blob_id.clone(),
            instrumental: read(&self.instrumental).blob_id.clone(),
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
    let stems = Separated::create(&context.storage.blobs_path);
    let running = Run {
        context,
        report,
        stems: &stems,
    };
    let found = separate(&running, job).await;
    for stem in stems.each() {
        let _ = remove_file(&stem.raw).await;
    }
    answer(found)
}

async fn separate(running: &Run<'_>, job: &PendingJob) -> Result<(), Failure> {
    let context = running.context;
    (running.report)(StepEvent::Progress(0.0));
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
    (running.report)(StepEvent::Progress(1.0));
    Ok(())
}

async fn process_stems(
    running: &Run<'_>,
    job: &PendingJob,
    sample_rate: u32,
) -> Result<(), Failure> {
    let context = running.context;
    split(running, job).await?;
    let stems = running.stems;
    let rates = SampleRates {
        input: VOCALS.sample_rate,
        output: sample_rate,
    };
    tokio::try_join!(
        encode_flac_from_raw(&stems.lead.raw, &stems.lead.master.path, rates),
        encode_flac_from_raw(&stems.backing.raw, &stems.backing.master.path, rates),
        encode_flac_from_raw(
            &stems.instrumental.raw,
            &stems.instrumental.master.path,
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
        read_at(&stem.master.path, sample_rate),
        &stem.delivery.path,
    )
    .await?;
    let request = WavePeaks {
        source: read_at(&stem.master.path, sample_rate),
        to: &stem.wave_peaks.path,
        total_frames: read_frame_count(&stem.master.path).await?,
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
        analyze_lead_visual_loudness(pcm, read_at(&stems.lead.master.path, sample_rate)),
        analyze_loudness(pcm, read_at(&stems.backing.master.path, sample_rate)),
        analyze_loudness(pcm, read_at(&stems.instrumental.master.path, sample_rate)),
    )?;
    let analysis = measure(
        source_loudness,
        &Stems {
            lead,
            backing,
            instrumental,
        },
    );
    let separation = NewSeparation {
        project_id: job.project_id,
        analysis,
        master: stems.blobs(|stem| &stem.master),
        delivery: stems.blobs(|stem| &stem.delivery),
        wave_peaks: stems.blobs(|stem| &stem.wave_peaks),
    };
    write_database(&context.storage, move |writer| {
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
    let pcm = collect_interleaved_pcm(
        context.storage.pcm.as_ref(),
        read_at(&source, VOCALS.sample_rate),
    )
    .await?;
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
        let stems = Separated::create(Path::new("/blobs"));

        let uploads = stems.uploads();
        let masters = stems.blobs(|stem| &stem.master);
        let named = [
            ("lead.pcm", &stems.lead, masters.lead),
            ("backing.pcm", &stems.backing, masters.backing),
            (
                "instrumental.pcm",
                &stems.instrumental,
                masters.instrumental,
            ),
        ];
        for (name, stem, blob_id) in named {
            assert_eq!(uploads.get(name), Some(&stem.raw));
            assert_eq!(stem.raw, stem.master.path.with_extension(RAW_SUFFIX));
            assert_eq!(blob_id, stem.master.blob_id);
        }
        assert_eq!(uploads.len(), 3);
    }
}
