use musetric_db::{PROCESSING_STEPS, ProcessingStep, StepState, StepStatus};
use serde_json::Value;

pub const STEP_ORDER: [ProcessingStep; 5] = PROCESSING_STEPS;

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

pub(crate) fn build_processing(states: &[StepState], active: Option<&ActiveStep>) -> Processing {
    let steps = STEP_ORDER.map(|step| build_step(step, states, active));
    Processing {
        done: steps.iter().all(|step| step.status == StepStatus::Done),
        steps,
    }
}

fn build_step(step: ProcessingStep, states: &[StepState], active: Option<&ActiveStep>) -> StepView {
    let found = states.iter().find(|state| state.step == step);
    StepView {
        status: found.map_or(StepStatus::Pending, |state| state.status),
        phase: active
            .filter(|running| running.step == step)
            .map(|running| running.phase.clone()),
        error: found.and_then(|state| state.error.clone()),
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
