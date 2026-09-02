use musetric_db::{PROCESSING_STEPS, ProcessingStep, StepFailure, StepResults};
use serde_json::Value;

pub const STEP_ORDER: [ProcessingStep; 5] = PROCESSING_STEPS;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StepStatus {
    Pending,
    Processing,
    Failed,
    Done,
}

impl StepStatus {
    #[must_use]
    pub fn name(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Processing => "processing",
            Self::Failed => "failed",
            Self::Done => "done",
        }
    }
}

#[derive(Clone, Debug)]
pub struct StepView {
    pub status: StepStatus,
    pub progress: Option<f64>,
    pub download: Option<Value>,
    pub error: Option<String>,
}

#[derive(Clone, Debug)]
pub struct Processing {
    pub done: bool,
    pub steps: [StepView; 5],
}

impl Processing {
    #[must_use]
    pub fn step(&self, step: ProcessingStep) -> &StepView {
        &self.steps[step_index(step)]
    }
}

pub(crate) struct ActiveStep {
    pub(crate) step: ProcessingStep,
    pub(crate) project_id: i64,
    pub(crate) progress: f64,
    pub(crate) download: Option<Value>,
}

pub(crate) fn build_processing(
    results: &StepResults,
    failures: &[StepFailure],
    active: Option<&ActiveStep>,
) -> Processing {
    let steps = STEP_ORDER.map(|step| build_step(step, results, failures, active));
    Processing {
        done: failures.is_empty()
            && results.has(ProcessingStep::Transcription)
            && results.has(ProcessingStep::Rhythm)
            && results.has(ProcessingStep::Key)
            && results.has(ProcessingStep::Chords),
        steps,
    }
}

fn build_step(
    step: ProcessingStep,
    results: &StepResults,
    failures: &[StepFailure],
    active: Option<&ActiveStep>,
) -> StepView {
    if let Some(failure) = failures.iter().find(|failure| failure.step == step) {
        return StepView {
            status: StepStatus::Failed,
            progress: None,
            download: None,
            error: Some(failure.message.clone()),
        };
    }
    if let Some(running) = active.filter(|running| running.step == step) {
        return StepView {
            status: StepStatus::Processing,
            progress: Some(running.progress),
            download: running.download.clone(),
            error: None,
        };
    }
    if results.has(step) {
        return StepView {
            status: StepStatus::Done,
            progress: Some(1.0),
            download: None,
            error: None,
        };
    }
    StepView {
        status: StepStatus::Pending,
        progress: None,
        download: None,
        error: None,
    }
}

fn step_index(step: ProcessingStep) -> usize {
    match step {
        ProcessingStep::Separation => 0,
        ProcessingStep::Transcription => 1,
        ProcessingStep::Rhythm => 2,
        ProcessingStep::Key => 3,
        ProcessingStep::Chords => 4,
    }
}
