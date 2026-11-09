use std::{
    collections::HashMap,
    fs::remove_dir_all,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, PoisonError},
    time::{Duration, Instant},
};

use musetric_db::BoxedError;
use musetric_media::MixdownWatch;
use tokio::fs::{create_dir_all, remove_file};
use uuid::Uuid;

const MIXDOWN_AREA: &str = "mixdown";
const LIFETIME: Duration = Duration::from_hours(1);

#[derive(Clone)]
pub(crate) struct MixdownFile {
    pub(crate) path: PathBuf,
    pub(crate) filename: String,
    pub(crate) content_type: &'static str,
}

#[derive(Clone)]
pub(crate) enum MixdownState {
    Running(Arc<MixdownWatch>),
    Ready(MixdownFile),
    Failed(String),
}

pub(crate) enum Removal {
    Missing,
    Stopping,
    Removed(Option<PathBuf>),
}

struct Entry {
    state: MixdownState,
    created: Instant,
}

pub(crate) struct Mixdowns {
    area: PathBuf,
    entries: Mutex<HashMap<String, Entry>>,
}

impl Mixdowns {
    pub(crate) fn create(work_path: &Path) -> Self {
        let area = work_path.join(MIXDOWN_AREA);
        let _ = remove_dir_all(&area);
        Self {
            area,
            entries: Mutex::default(),
        }
    }

    pub(crate) async fn reserve(&self) -> Result<(String, PathBuf), BoxedError> {
        for expired in self.take_expired() {
            let _ = remove_file(&expired.path).await;
        }
        create_dir_all(&self.area).await?;
        let mixdown_id = Uuid::new_v4().to_string();
        let path = self.area.join(&mixdown_id);
        Ok((mixdown_id, path))
    }

    pub(crate) fn start(&self, mixdown_id: String, watch: Arc<MixdownWatch>) {
        self.lock().insert(
            mixdown_id,
            Entry {
                state: MixdownState::Running(watch),
                created: Instant::now(),
            },
        );
    }

    pub(crate) fn settle(&self, mixdown_id: &str, outcome: Result<MixdownFile, String>) -> bool {
        let mut entries = self.lock();
        let Some(entry) = entries.get_mut(mixdown_id) else {
            return false;
        };
        if let MixdownState::Running(watch) = &entry.state
            && watch.stopped()
        {
            entries.remove(mixdown_id);
            return false;
        }
        let kept = outcome.is_ok();
        entry.state = match outcome {
            Ok(file) => MixdownState::Ready(file),
            Err(message) => MixdownState::Failed(message),
        };
        kept
    }

    pub(crate) fn find(&self, mixdown_id: &str) -> Option<MixdownState> {
        self.lock().get(mixdown_id).map(|entry| entry.state.clone())
    }

    pub(crate) fn remove(&self, mixdown_id: &str) -> Removal {
        let mut entries = self.lock();
        let Some(entry) = entries.get(mixdown_id) else {
            return Removal::Missing;
        };
        if let MixdownState::Running(watch) = &entry.state {
            watch.stop();
            return Removal::Stopping;
        }
        match entries.remove(mixdown_id).map(|removed| removed.state) {
            Some(MixdownState::Ready(file)) => Removal::Removed(Some(file.path)),
            _ => Removal::Removed(None),
        }
    }

    fn take_expired(&self) -> Vec<MixdownFile> {
        let mut entries = self.lock();
        let expired: Vec<String> = entries
            .iter()
            .filter(|(_, entry)| {
                entry.created.elapsed() > LIFETIME
                    && !matches!(entry.state, MixdownState::Running(_))
            })
            .map(|(mixdown_id, _)| mixdown_id.clone())
            .collect();
        expired
            .iter()
            .filter_map(|mixdown_id| match entries.remove(mixdown_id)?.state {
                MixdownState::Ready(file) => Some(file),
                MixdownState::Running(_) | MixdownState::Failed(_) => None,
            })
            .collect()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Entry>> {
        self.entries.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use std::{path::PathBuf, sync::Arc};

    use musetric_media::MixdownWatch;

    use super::{MixdownFile, MixdownState, Mixdowns, Removal};
    use crate::test_workspace::Workspace;

    fn file(name: &str) -> MixdownFile {
        MixdownFile {
            path: PathBuf::from(name),
            filename: name.to_owned(),
            content_type: "audio/wav",
        }
    }

    #[test]
    fn keeps_a_finished_file_until_it_is_removed() {
        let workspace = Workspace::new();
        let mixdowns = Mixdowns::create(&workspace.work_path());
        mixdowns.start("done".to_owned(), Arc::new(MixdownWatch::default()));
        assert!(matches!(
            mixdowns.find("done"),
            Some(MixdownState::Running(_))
        ));
        assert!(mixdowns.settle("done", Ok(file("done.wav"))));
        assert!(matches!(
            mixdowns.find("done"),
            Some(MixdownState::Ready(_))
        ));
        assert!(matches!(
            mixdowns.remove("done"),
            Removal::Removed(Some(path)) if path.as_os_str() == "done.wav"
        ));
        assert!(mixdowns.find("done").is_none());
        assert!(matches!(mixdowns.remove("done"), Removal::Missing));
    }

    #[test]
    fn drops_a_mixdown_stopped_before_it_settles() {
        let workspace = Workspace::new();
        let mixdowns = Mixdowns::create(&workspace.work_path());
        let watch = Arc::new(MixdownWatch::default());
        mixdowns.start("stopped".to_owned(), Arc::clone(&watch));
        assert!(matches!(mixdowns.remove("stopped"), Removal::Stopping));
        assert!(watch.stopped());
        assert!(!mixdowns.settle("stopped", Ok(file("stopped.wav"))));
        assert!(mixdowns.find("stopped").is_none());
    }

    #[test]
    fn keeps_the_failure_of_a_mixdown_and_no_file() {
        let workspace = Workspace::new();
        let mixdowns = Mixdowns::create(&workspace.work_path());
        mixdowns.start("failed".to_owned(), Arc::new(MixdownWatch::default()));
        assert!(!mixdowns.settle("failed", Err("encoder failed".to_owned())));
        assert!(matches!(
            mixdowns.find("failed"),
            Some(MixdownState::Failed(error)) if error == "encoder failed"
        ));
        assert!(matches!(mixdowns.remove("failed"), Removal::Removed(None)));
    }
}
