mod browser;
mod checkpoint_persist;
mod gains;
mod json_units;
pub(crate) mod models;
mod result_check;
mod separation;
mod separation_sink;
mod stage_attempt;
mod stem_files;
mod steps;
mod transcribe;
mod transcribe_units;

use std::{path::PathBuf, sync::Arc};

use musetric_db::{PendingJob, ProcessingStep};

pub(crate) use gains::{Gains, read_gains};
use musetric_jobs::{StepOutcome, StepReport, StepRunner};
use reqwest::Client;

use musetric_gpu::ExecutorHost;

use crate::{analysis::models::ModelPins, storage::Storage};

pub(crate) struct AnalysisContext {
    pub(crate) storage: Arc<Storage>,
    pub(crate) client: Client,
    pub(crate) models_path: PathBuf,
    pub(crate) pins: Arc<ModelPins>,
    pub(crate) host: Arc<ExecutorHost>,
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
    fn rest(&self) {
        self.context.host.reload_executor();
    }

    fn run<'a>(&'a self, job: &'a PendingJob, report: &'a StepReport) -> StepOutcome<'a> {
        match job.step {
            ProcessingStep::Transcription => Box::pin(transcribe::run(&self.context, job, report)),
            _ => {
                match steps::create(job.step, &self.context.models_path, &self.context.pins) {
                    Some(analysis) => Box::pin(async move {
                        browser::run(&self.context, job, report, &analysis).await
                    }),
                    None => Box::pin(separation::run(&self.context, job, report)),
                }
            }
        }
    }
}
