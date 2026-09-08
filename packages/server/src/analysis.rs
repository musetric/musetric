mod browser;
mod gains;
mod json_units;
mod models;
mod separation;
mod stage_attempt;
mod stage_units;
mod stem_files;
mod stem_signal;
mod steps;
mod voices;

#[cfg(test)]
mod tests;

use std::{path::PathBuf, sync::Arc};

use musetric_db::{PendingJob, ProcessingStep};

pub(crate) use gains::{Gains, read_gains};
use musetric_jobs::{StepOutcome, StepReport, StepRunner};
use reqwest::Client;

use musetric_gpu::Bundle;

use crate::{pages::PageOpener, storage::Storage};

pub(crate) struct AnalysisContext {
    pub(crate) storage: Arc<Storage>,
    pub(crate) pages: Arc<dyn PageOpener>,
    pub(crate) client: Client,
    pub(crate) models_path: PathBuf,
    pub(crate) bundle: Bundle,
}

pub(crate) struct AnalysisRunner {
    context: AnalysisContext,
}

impl AnalysisRunner {
    pub(crate) fn create(context: AnalysisContext) -> Self {
        Self { context }
    }
}

impl StepRunner for AnalysisRunner {
    fn run<'a>(&'a self, job: &'a PendingJob, report: &'a StepReport) -> StepOutcome<'a> {
        match steps::create(job.step, &self.context.models_path) {
            Some(analysis) => {
                Box::pin(async move { browser::run(&self.context, job, report, &analysis).await })
            }
            None if job.step == ProcessingStep::Voices => {
                Box::pin(voices::run(&self.context, job, report))
            }
            None => Box::pin(separation::run(&self.context, job, report)),
        }
    }
}
