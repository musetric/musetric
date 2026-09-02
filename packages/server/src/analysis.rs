mod browser;
mod models;
mod page;
mod steps;

#[cfg(test)]
mod tests;

use std::{path::PathBuf, sync::Arc};

use musetric_db::PendingJob;
use musetric_jobs::{StepOutcome, StepReport, StepRunner};
use reqwest::Client;

use crate::{jobs::UpstreamRunner, proxy::ProxyState, storage::Storage};

pub(crate) struct AnalysisContext {
    pub(crate) storage: Arc<Storage>,
    pub(crate) proxy: ProxyState,
    pub(crate) client: Client,
    pub(crate) models_path: PathBuf,
    pub(crate) bundle_path: PathBuf,
}

pub(crate) struct AnalysisRunner {
    context: AnalysisContext,
    upstream: UpstreamRunner,
}

impl AnalysisRunner {
    pub(crate) fn create(context: AnalysisContext) -> Self {
        let upstream = UpstreamRunner::create(context.proxy.clone());
        Self { context, upstream }
    }
}

impl StepRunner for AnalysisRunner {
    fn run<'a>(&'a self, job: &'a PendingJob, report: &'a StepReport) -> StepOutcome<'a> {
        match steps::create(job.step, &self.context.models_path) {
            Some(analysis) => {
                Box::pin(async move { browser::run(&self.context, job, report, &analysis).await })
            }
            None => self.upstream.run(job, report),
        }
    }
}
