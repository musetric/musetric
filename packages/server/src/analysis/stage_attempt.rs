use std::path::{Path, PathBuf};

use musetric_db::{PendingJob, ProcessingStep};
use musetric_jobs::{StepAnswer, StepReport};

use crate::{
    analysis::{
        AnalysisContext,
        browser::{Failure, answer},
    },
    blobs::{StagedBlob, close_area, ensure_area, step_area},
    storage::read_database,
};

pub(crate) struct StageRun<'run> {
    pub(crate) context: &'run AnalysisContext,
    pub(crate) report: &'run StepReport,
    pub(crate) project_id: i64,
    pub(crate) step: ProcessingStep,
}

impl StageRun<'_> {
    pub(crate) async fn project_sample_rate(&self) -> Result<u32, Failure> {
        let project_id = self.project_id;
        let found = read_database(&self.context.storage, move |database| {
            database.project(project_id)
        })
        .await?;
        let project = found
            .ok_or_else(|| Failure::Refused(format!("Project with id {project_id} not found")))?;
        u32::try_from(project.sample_rate)
            .map_err(|_| Failure::Refused("The project sample rate is out of range".to_owned()))
    }

    pub(crate) fn area(&self) -> PathBuf {
        step_area(&self.context.storage.work_path, self.project_id, self.step)
    }
}

pub(crate) trait StepStems: Sized {
    fn create(area: &Path, blobs_path: &Path) -> Self;
    fn staged(&self) -> Vec<&StagedBlob>;
}

pub(crate) async fn run_step<Stems: StepStems>(
    context: &AnalysisContext,
    job: &PendingJob,
    report: &StepReport,
    produce: impl AsyncFnOnce(&StageRun<'_>, &PendingJob, &Stems) -> Result<(), Failure>,
) -> StepAnswer {
    let running = StageRun {
        context,
        report,
        project_id: job.project_id,
        step: job.step,
    };
    let area = running.area();
    if let Err(error) = ensure_area(&area).await {
        return answer(Err(Failure::from(error.to_string())));
    }
    let stems = Stems::create(&area, &context.storage.blobs_path);
    let found = produce(&running, job, &stems).await;
    if found.is_ok() {
        close_area(&area).await;
    }
    answer(found)
}

pub(crate) fn cached_model(models: &[(String, PathBuf)], name: &str) -> Result<PathBuf, Failure> {
    models
        .iter()
        .find(|(file, _)| file == name)
        .map(|(_, path)| path.clone())
        .ok_or_else(|| Failure::Refused(format!("The model cache is missing {name}")))
}
