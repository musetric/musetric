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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StepPass {
    Decode,
    Repair,
}

impl StepPass {
    #[must_use]
    pub fn name(self) -> &'static str {
        match self {
            Self::Decode => "decode",
            Self::Repair => "repair",
        }
    }
}

#[derive(Clone, Debug)]
pub enum StepPhase {
    Preparing {
        download: Option<Value>,
    },
    Decoding {
        decoded: u64,
        total: u64,
    },
    Loading,
    Running {
        pass: StepPass,
        unit: u32,
        unit_count: u32,
    },
    Saving,
}

impl StepPhase {
    #[must_use]
    pub fn name(&self) -> &'static str {
        match self {
            Self::Preparing { .. } => "preparing",
            Self::Decoding { .. } => "decoding",
            Self::Loading => "loading",
            Self::Running { .. } => "running",
            Self::Saving => "saving",
        }
    }
}

#[derive(Clone, Debug)]
pub struct StepView {
    pub status: StepStatus,
    pub phase: Option<StepPhase>,
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
    pub(crate) phase: StepPhase,
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
            phase: None,
            error: Some(failure.message.clone()),
        };
    }
    if let Some(running) = active.filter(|running| running.step == step) {
        return StepView {
            status: StepStatus::Processing,
            phase: Some(running.phase.clone()),
            error: None,
        };
    }
    let status = if results.has(step) {
        StepStatus::Done
    } else {
        StepStatus::Pending
    };
    StepView {
        status,
        phase: None,
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
