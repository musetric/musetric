use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{Arc, Mutex, MutexGuard},
};

use axum::body::Bytes;
use musetric_gpu::{UnitCompleted, UnitReject, UnitSession, UnitTarget, UnitWrite};
use tokio::{fs, sync::oneshot};

use crate::{
    analysis::browser::Failure,
    unit_fold::FoldAccumulator,
    unit_plan::{PlanRules, UnitPlan},
};

const PART_SUFFIX: &str = ".part";
const STAGE_LOST: &str = "the attempt is not active";

pub(crate) struct StageRegistration {
    pub(crate) attempt: String,
    pub(crate) plan: UnitPlan,
    pub(crate) input: Arc<Vec<f32>>,
    pub(crate) outputs: Vec<String>,
    pub(crate) rules: PlanRules,
}

pub(crate) struct SeparationUnits {
    root: PathBuf,
    stages: Mutex<HashMap<String, Arc<Stage>>>,
}

struct Stage {
    plan: UnitPlan,
    input: Arc<Vec<f32>>,
    outputs: Vec<String>,
    state: Mutex<StageState>,
    fold: Mutex<FoldAccumulator>,
}

struct StageState {
    accepted: HashSet<(u32, String)>,
    folded: HashSet<u32>,
    opened: Option<oneshot::Sender<()>>,
    opened_receiver: Option<oneshot::Receiver<()>>,
    senders: HashMap<u32, oneshot::Sender<()>>,
    receivers: HashMap<u32, oneshot::Receiver<()>>,
}

const POISONED_UNITS: &str = "the separation units are poisoned";

impl SeparationUnits {
    pub(crate) fn create(root: PathBuf) -> Self {
        Self {
            root,
            stages: Mutex::new(HashMap::new()),
        }
    }

    pub(crate) fn register(&self, registration: StageRegistration) -> Result<(), Failure> {
        if registration.rules != registration.plan.rules {
            return Err(Failure::Refused(
                "the stage registration does not match the plan rules".to_owned(),
            ));
        }
        let frames = u64::try_from(registration.input.len() / registration.plan.channels as usize)
            .unwrap_or(0);
        let fold = FoldAccumulator::create(frames, registration.plan.channels);
        let mut senders = HashMap::new();
        let mut receivers = HashMap::new();
        for unit in 0..registration.plan.unit_count() {
            let (sender, receiver) = oneshot::channel();
            senders.insert(unit, sender);
            receivers.insert(unit, receiver);
        }
        let (opened, opened_receiver) = oneshot::channel();
        let stage = Arc::new(Stage {
            plan: registration.plan,
            input: registration.input,
            outputs: registration.outputs,
            state: Mutex::new(StageState {
                accepted: HashSet::new(),
                folded: HashSet::new(),
                opened: Some(opened),
                opened_receiver: Some(opened_receiver),
                senders,
                receivers,
            }),
            fold: Mutex::new(fold),
        });
        self.stages
            .lock()
            .map_err(|_| Failure::Refused(POISONED_UNITS.to_owned()))?
            .insert(registration.attempt, stage);
        Ok(())
    }

    pub(crate) async fn wait_opened(&self, attempt: &str) -> Result<(), Failure> {
        let receiver = {
            let stage = self.stage(attempt)?;
            let mut guard = Self::lock_state(&stage)?;
            guard.opened_receiver.take().ok_or_else(|| {
                Failure::Refused("the attempt open was already awaited".to_owned())
            })?
        };
        receiver
            .await
            .map_err(|_| Failure::Refused("the attempt open was dropped".to_owned()))
    }

    pub(crate) async fn folded(&self, attempt: &str, unit: u32) -> Result<(), Failure> {
        let receiver = {
            let stage = self.stage(attempt)?;
            let mut guard = Self::lock_state(&stage)?;
            if guard.folded.contains(&unit) {
                return Ok(());
            }
            guard
                .receivers
                .remove(&unit)
                .ok_or_else(|| Failure::Refused("the unit fold was already awaited".to_owned()))?
        };
        receiver
            .await
            .map_err(|_| Failure::Refused("the unit fold was dropped".to_owned()))
    }

    pub(crate) fn finalize(&self, attempt: &str) -> Result<Vec<f32>, Failure> {
        let stage = self
            .stages
            .lock()
            .map_err(|_| Failure::Refused(POISONED_UNITS.to_owned()))?
            .remove(attempt)
            .ok_or_else(|| Failure::Refused(STAGE_LOST.to_owned()))?;
        let guard = Self::lock_state(&stage)?;
        if guard.folded.len() != stage.plan.unit_count() as usize {
            return Err(Failure::Refused(
                "the attempt did not fold every unit".to_owned(),
            ));
        }
        drop(guard);
        let fold = stage
            .fold
            .lock()
            .map_err(|_| Failure::Refused("the separation fold is poisoned".to_owned()))?;
        Ok(fold.finalize())
    }

    fn stage(&self, attempt: &str) -> Result<Arc<Stage>, Failure> {
        self.stages
            .lock()
            .map_err(|_| Failure::Refused(POISONED_UNITS.to_owned()))?
            .get(attempt)
            .cloned()
            .ok_or_else(|| Failure::Refused("the attempt is not active".to_owned()))
    }

    fn lock_state(stage: &Stage) -> Result<MutexGuard<'_, StageState>, Failure> {
        stage
            .state
            .lock()
            .map_err(|_| Failure::Refused("the attempt state is poisoned".to_owned()))
    }

    fn unit_dir(&self, attempt: &str, unit: u32) -> PathBuf {
        self.root.join(attempt).join(unit.to_string())
    }

    fn part_path(&self, attempt: &str, unit: u32, output: &str) -> PathBuf {
        self.unit_dir(attempt, unit)
            .join(format!("{output}{PART_SUFFIX}"))
    }

    fn ready_path(&self, attempt: &str, unit: u32, output: &str) -> PathBuf {
        self.unit_dir(attempt, unit).join(output)
    }

    fn expected(stage: &Stage) -> u64 {
        u64::from(stage.plan.chunk_samples) * u64::from(stage.plan.channels) * 4
    }

    fn mark_accepted(stage: &Stage, unit: u32, output: &str) -> Result<bool, String> {
        let mut guard =
            Self::lock_state(stage).map_err(|_| "the attempt state is poisoned".to_owned())?;
        if guard.folded.contains(&unit) {
            return Ok(false);
        }
        guard.accepted.insert((unit, output.to_owned()));
        Ok(stage
            .outputs
            .iter()
            .all(|name| guard.accepted.contains(&(unit, name.clone()))))
    }

    async fn fold(&self, stage: &Stage, attempt: &str, unit: u32) -> Result<(), String> {
        {
            let guard =
                Self::lock_state(stage).map_err(|_| "the attempt state is poisoned".to_owned())?;
            if guard.folded.contains(&unit) {
                return Ok(());
            }
        }
        let index = unit as usize;
        let mut chunk = Vec::new();
        for output in &stage.outputs {
            let bytes = fs::read(self.ready_path(attempt, unit, output))
                .await
                .map_err(|error| error.to_string())?;
            let samples: Vec<f32> = bytes
                .chunks_exact(4)
                .filter_map(|raw| {
                    raw.first_chunk::<4>()
                        .map(|value| f32::from_le_bytes(*value))
                })
                .collect();
            if samples.len() * 4 != bytes.len() {
                return Err("the accepted unit output is not frame aligned".to_owned());
            }
            chunk.extend(samples);
        }
        let waker = {
            let mut fold = stage
                .fold
                .lock()
                .map_err(|_| "the separation fold is poisoned".to_owned())?;
            let mut guard =
                Self::lock_state(stage).map_err(|_| "the attempt state is poisoned".to_owned())?;
            if guard.folded.contains(&unit) {
                return Ok(());
            }
            fold.add(&stage.plan, index, &chunk);
            guard.folded.insert(unit);
            for output in &stage.outputs {
                guard.accepted.remove(&(unit, output.clone()));
            }
            guard.senders.remove(&unit)
        };
        if let Some(sender) = waker {
            let _ = sender.send(());
        }
        let _ = fs::remove_dir_all(self.unit_dir(attempt, unit)).await;
        Ok(())
    }
}

impl UnitSession for SeparationUnits {
    fn window(&self, attempt: &str, unit: u32) -> Result<Bytes, UnitReject> {
        let stage = self
            .stages
            .lock()
            .map_err(|_| UnitReject::Bad(POISONED_UNITS.to_owned()))?
            .get(attempt)
            .cloned()
            .ok_or(UnitReject::Stale)?;
        if unit >= stage.plan.unit_count() {
            return Err(UnitReject::Bad("the unit is outside the plan".to_owned()));
        }
        Ok(Bytes::from(
            stage.plan.window_bytes(&stage.input, unit as usize),
        ))
    }

    fn target(&self, attempt: &str, unit: u32, output: &str) -> Result<UnitTarget, UnitReject> {
        let stage = self
            .stages
            .lock()
            .map_err(|_| UnitReject::Bad(POISONED_UNITS.to_owned()))?
            .get(attempt)
            .cloned()
            .ok_or(UnitReject::Stale)?;
        if unit >= stage.plan.unit_count() {
            return Err(UnitReject::Bad("the unit is outside the plan".to_owned()));
        }
        if !stage.outputs.iter().any(|name| name == output) {
            return Err(UnitReject::Bad(format!(
                "the unit output {output} is not declared"
            )));
        }
        let guard = Self::lock_state(&stage)
            .map_err(|_| UnitReject::Bad("the attempt state is poisoned".to_owned()))?;
        if guard.folded.contains(&unit) {
            return Ok(UnitTarget::Confirm);
        }
        if guard.accepted.contains(&(unit, output.to_owned())) {
            return Ok(UnitTarget::Compare {
                ready: self.ready_path(attempt, unit, output),
            });
        }
        Ok(UnitTarget::Write(UnitWrite::create(
            self.part_path(attempt, unit, output),
            self.ready_path(attempt, unit, output),
            Self::expected(&stage),
        )))
    }

    fn completed<'a>(&'a self, attempt: &'a str, unit: u32, output: &'a str) -> UnitCompleted<'a> {
        Box::pin(async move {
            let stage = self.stage(attempt).map_err(|_| STAGE_LOST.to_owned())?;
            if Self::mark_accepted(&stage, unit, output)? {
                self.fold(&stage, attempt, unit).await?;
            }
            Ok(())
        })
    }

    fn aborted(&self, _attempt: &str, _unit: u32, _output: &str) {}

    fn opened(&self, attempt: &str) -> Result<(), String> {
        let stage = self.stage(attempt).map_err(|_| STAGE_LOST.to_owned())?;
        let mut guard =
            Self::lock_state(&stage).map_err(|_| "the attempt state is poisoned".to_owned())?;
        if let Some(sender) = guard.opened.take() {
            let _ = sender.send(());
        }
        Ok(())
    }

    fn done(&self, attempt: &str, unit: u32) -> Result<(), String> {
        let registered = self
            .stages
            .lock()
            .map_err(|_| POISONED_UNITS.to_owned())?
            .contains_key(attempt);
        if !registered {
            return Ok(());
        }
        let count = self
            .stages
            .lock()
            .map_err(|_| POISONED_UNITS.to_owned())?
            .get(attempt)
            .map(|stage| stage.plan.unit_count())
            .unwrap_or_default();
        if unit >= count {
            return Err("the done event points outside the plan".to_owned());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests;
