use std::{
    collections::HashMap,
    fs::remove_dir_all,
    path::{Path, PathBuf},
    sync::{Mutex, PoisonError},
    time::{Duration, Instant},
};

use musetric_db::BoxedError;
use tokio::fs::{create_dir_all, remove_file};
use uuid::Uuid;

const MIXDOWN_AREA: &str = "mixdown";
const LIFETIME: Duration = Duration::from_hours(1);

#[derive(Clone)]
pub(crate) struct MixdownFile {
    pub(crate) path: PathBuf,
    pub(crate) filename: String,
    pub(crate) content_type: &'static str,
    created: Instant,
}

impl MixdownFile {
    pub(crate) fn create(path: PathBuf, filename: String, content_type: &'static str) -> Self {
        Self {
            path,
            filename,
            content_type,
            created: Instant::now(),
        }
    }
}

pub(crate) struct Mixdowns {
    area: PathBuf,
    files: Mutex<HashMap<String, MixdownFile>>,
}

impl Mixdowns {
    pub(crate) fn create(work_path: &Path) -> Self {
        let area = work_path.join(MIXDOWN_AREA);
        let _ = remove_dir_all(&area);
        Self {
            area,
            files: Mutex::default(),
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

    pub(crate) fn register(&self, mixdown_id: String, file: MixdownFile) {
        self.lock().insert(mixdown_id, file);
    }

    pub(crate) fn find(&self, mixdown_id: &str) -> Option<MixdownFile> {
        self.lock().get(mixdown_id).cloned()
    }

    fn take_expired(&self) -> Vec<MixdownFile> {
        let mut files = self.lock();
        let expired: Vec<String> = files
            .iter()
            .filter(|(_, file)| file.created.elapsed() > LIFETIME)
            .map(|(mixdown_id, _)| mixdown_id.clone())
            .collect();
        expired
            .iter()
            .filter_map(|mixdown_id| files.remove(mixdown_id))
            .collect()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, MixdownFile>> {
        self.files.lock().unwrap_or_else(PoisonError::into_inner)
    }
}
