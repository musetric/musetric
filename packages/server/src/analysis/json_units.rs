use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{Arc, Mutex, MutexGuard},
};

use axum::body::Bytes;
use musetric_gpu::{UnitCompleted, UnitPayload, UnitReject, UnitSession, UnitTarget, UnitWrite};
use serde_json::Value;
use tokio::{fs, sync::Notify};

use crate::analysis::browser::Failure;

const PART_SUFFIX: &str = ".part";
const RESULT: &str = "result";
const STAGE_LOST: &str = "the attempt is not active";
const POISONED_UNITS: &str = "the analysis units are poisoned";
const MAX_RESULT: u64 = 16 * 1024 * 1024;

pub(crate) struct JsonUnits {
    root: PathBuf,
    stages: Mutex<HashMap<String, Arc<Stage>>>,
}

struct Stage {
    input: Arc<Vec<u8>>,
    state: Mutex<StageState>,
    opened: Notify,
    folded: Notify,
}

struct StageState {
    accepted: HashSet<u32>,
    open: bool,
    ready: bool,
    result: Option<Value>,
}

impl JsonUnits {
    pub(crate) fn create(root: PathBuf) -> Self {
        Self {
            root,
            stages: Mutex::new(HashMap::new()),
        }
    }

    pub(crate) fn register(&self, attempt: String, input: Arc<Vec<u8>>) -> Result<(), Failure> {
        let stage = Arc::new(Stage {
            input,
            state: Mutex::new(StageState {
                accepted: HashSet::new(),
                open: false,
                ready: false,
                result: None,
            }),
            opened: Notify::new(),
            folded: Notify::new(),
        });
        self.stages
            .lock()
            .map_err(|_| Failure::Refused(POISONED_UNITS.to_owned()))?
            .insert(attempt, stage);
        Ok(())
    }

    pub(crate) async fn wait_opened(&self, attempt: &str) -> Result<(), Failure> {
        let stage = self.stage(attempt)?;
        let wait = stage.opened.notified();
        if Self::lock_state(&stage)?.open {
            return Ok(());
        }
        wait.await;
        Ok(())
    }

    pub(crate) async fn folded(&self, attempt: &str) -> Result<(), Failure> {
        let stage = self.stage(attempt)?;
        let wait = stage.folded.notified();
        if Self::lock_state(&stage)?.ready {
            return Ok(());
        }
        wait.await;
        Ok(())
    }

    pub(crate) fn finalize(&self, attempt: &str) -> Result<Value, Failure> {
        let stage = self
            .stages
            .lock()
            .map_err(|_| Failure::Refused(POISONED_UNITS.to_owned()))?
            .remove(attempt)
            .ok_or_else(|| Failure::Refused(STAGE_LOST.to_owned()))?;
        let guard = Self::lock_state(&stage)?;
        guard
            .result
            .clone()
            .ok_or_else(|| Failure::Refused("the attempt did not fold the result".to_owned()))
    }

    fn stage(&self, attempt: &str) -> Result<Arc<Stage>, Failure> {
        self.stages
            .lock()
            .map_err(|_| Failure::Refused(POISONED_UNITS.to_owned()))?
            .get(attempt)
            .cloned()
            .ok_or_else(|| Failure::Refused(STAGE_LOST.to_owned()))
    }

    fn take_result(stage: &Stage, unit: u32, parsed: Value) -> Result<bool, String> {
        let mut guard =
            Self::lock_state(stage).map_err(|_| "the attempt state is poisoned".to_owned())?;
        if guard.ready {
            return Ok(false);
        }
        guard.accepted.insert(unit);
        guard.ready = true;
        guard.result = Some(parsed);
        Ok(true)
    }

    fn lock_state(stage: &Stage) -> Result<MutexGuard<'_, StageState>, Failure> {
        stage
            .state
            .lock()
            .map_err(|_| Failure::Refused("the attempt state is poisoned".to_owned()))
    }

    fn unit_dir(&self, attempt: &str) -> PathBuf {
        self.root.join(attempt).join("0")
    }

    fn part_path(&self, attempt: &str) -> PathBuf {
        self.unit_dir(attempt)
            .join(format!("{RESULT}{PART_SUFFIX}"))
    }

    fn ready_path(&self, attempt: &str) -> PathBuf {
        self.unit_dir(attempt).join(RESULT)
    }
}

impl UnitSession for JsonUnits {
    fn window(&self, attempt: &str, unit: u32) -> Result<Bytes, UnitReject> {
        if unit != 0 {
            return Err(UnitReject::Bad("the unit is outside the plan".to_owned()));
        }
        let stage = self
            .stages
            .lock()
            .map_err(|_| UnitReject::Bad(POISONED_UNITS.to_owned()))?
            .get(attempt)
            .cloned()
            .ok_or(UnitReject::Stale)?;
        Ok(Bytes::from(stage.input.as_ref().clone()))
    }

    fn target(&self, attempt: &str, unit: u32, output: &str) -> Result<UnitTarget, UnitReject> {
        if unit != 0 {
            return Err(UnitReject::Bad("the unit is outside the plan".to_owned()));
        }
        if output != RESULT {
            return Err(UnitReject::Bad(format!(
                "the unit output {output} is not declared"
            )));
        }
        let stage = self
            .stages
            .lock()
            .map_err(|_| UnitReject::Bad(POISONED_UNITS.to_owned()))?
            .get(attempt)
            .cloned()
            .ok_or(UnitReject::Stale)?;
        let guard = Self::lock_state(&stage)
            .map_err(|_| UnitReject::Bad("the attempt state is poisoned".to_owned()))?;
        if guard.ready {
            return Ok(UnitTarget::Confirm);
        }
        if guard.accepted.contains(&0) {
            return Ok(UnitTarget::Compare {
                ready: self.ready_path(attempt),
            });
        }
        Ok(UnitTarget::Write(UnitWrite::create(
            self.part_path(attempt),
            self.ready_path(attempt),
            MAX_RESULT,
            UnitPayload::Bytes,
        )))
    }

    fn completed<'a>(&'a self, attempt: &'a str, unit: u32, _output: &'a str) -> UnitCompleted<'a> {
        Box::pin(async move {
            let stage = self.stage(attempt).map_err(|_| STAGE_LOST.to_owned())?;
            let bytes = fs::read(self.ready_path(attempt))
                .await
                .map_err(|error| error.to_string())?;
            let parsed: Value = serde_json::from_slice(&bytes)
                .map_err(|_| "the unit output is not json".to_owned())?;
            if Self::take_result(&stage, unit, parsed)? {
                stage.folded.notify_waiters();
            }
            let _ = fs::remove_dir_all(self.unit_dir(attempt)).await;
            Ok(())
        })
    }

    fn aborted(&self, _attempt: &str, _unit: u32, _output: &str) {}

    fn opened(&self, attempt: &str) -> Result<(), String> {
        let stage = self.stage(attempt).map_err(|_| STAGE_LOST.to_owned())?;
        Self::lock_state(&stage)
            .map_err(|_| "the attempt state is poisoned".to_owned())?
            .open = true;
        stage.opened.notify_waiters();
        Ok(())
    }

    fn done(&self, _attempt: &str, unit: u32) -> Result<(), String> {
        if unit != 0 {
            return Err("the done event points outside the plan".to_owned());
        }
        Ok(())
    }
}
