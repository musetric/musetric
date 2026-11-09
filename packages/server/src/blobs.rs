use std::path::{Path, PathBuf};

use musetric_db::{BoxedError, ProcessingStep, blob_path};
use tokio::fs::{File, create_dir_all, remove_dir_all, remove_file, rename};
use uuid::Uuid;

const UPLOAD_AREA: &str = "upload";
const RECORDING_AREA: &str = "recording";

pub(crate) fn upload_area(work_path: &Path) -> PathBuf {
    work_path.join(UPLOAD_AREA)
}

pub(crate) fn clear_upload_area(work_path: &Path) {
    let _ = std::fs::remove_dir_all(upload_area(work_path));
}

pub(crate) fn project_area(work_path: &Path, project_id: i64) -> PathBuf {
    work_path.join(project_id.to_string())
}

pub(crate) fn read_project_area_id(area: &Path) -> Option<i64> {
    area.file_name()?.to_str()?.parse().ok()
}

pub(crate) fn step_area(work_path: &Path, project_id: i64, step: ProcessingStep) -> PathBuf {
    project_area(work_path, project_id).join(step.name())
}

pub(crate) fn recording_area(work_path: &Path, project_id: i64) -> PathBuf {
    project_area(work_path, project_id).join(RECORDING_AREA)
}

pub(crate) async fn open_area(area: &Path) -> Result<(), BoxedError> {
    remove_dir_all(area).await.ok();
    create_dir_all(area).await?;
    Ok(())
}

pub(crate) async fn ensure_area(area: &Path) -> Result<(), BoxedError> {
    create_dir_all(area).await?;
    Ok(())
}

pub(crate) async fn close_area(area: &Path) {
    let _ = remove_dir_all(area).await;
}

pub(crate) struct StagedBlob {
    blob_id: String,
    staged: PathBuf,
    committed: PathBuf,
}

pub(crate) fn stage_blob(area: &Path, blobs_path: &Path) -> StagedBlob {
    let blob_id = Uuid::new_v4().to_string();
    StagedBlob {
        staged: area.join(&blob_id),
        committed: blob_path(blobs_path, &blob_id),
        blob_id,
    }
}

impl StagedBlob {
    pub(crate) fn blob_id(&self) -> &str {
        &self.blob_id
    }

    pub(crate) fn path(&self) -> &Path {
        &self.staged
    }

    pub(crate) async fn create(&self) -> Result<File, BoxedError> {
        if let Some(directory) = self.staged.parent() {
            create_dir_all(directory).await?;
        }
        Ok(File::create(&self.staged).await?)
    }

    pub(crate) async fn commit(&self) -> Result<(), BoxedError> {
        if let Some(directory) = self.committed.parent() {
            create_dir_all(directory).await?;
        }
        rename(&self.staged, &self.committed).await?;
        Ok(())
    }

    pub(crate) async fn discard(&self) {
        let _ = remove_file(&self.staged).await;
    }
}

#[cfg(test)]
mod tests {
    use std::{fs::remove_dir_all, path::PathBuf};

    use musetric_db::blob_path;
    use tokio::{fs::try_exists, io::AsyncWriteExt};
    use uuid::Uuid;

    use super::{clear_upload_area, stage_blob, upload_area};

    struct Directories {
        root: PathBuf,
        blobs: PathBuf,
        area: PathBuf,
    }

    impl Directories {
        fn create() -> Self {
            let root = std::env::temp_dir().join(format!("musetric-blobs-{}", Uuid::new_v4()));
            Self {
                blobs: root.join("blobs"),
                area: upload_area(&root.join("work")),
                root,
            }
        }
    }

    impl Drop for Directories {
        fn drop(&mut self) {
            let _ = remove_dir_all(&self.root);
        }
    }

    #[tokio::test]
    async fn keeps_a_staged_blob_out_of_the_blob_tree_until_it_commits() {
        let directories = Directories::create();
        let staged = stage_blob(&directories.area, &directories.blobs);
        let committed = blob_path(&directories.blobs, staged.blob_id());

        let mut file = staged.create().await.expect("the staged file should open");
        file.write_all(b"payload")
            .await
            .expect("the staged file should accept bytes");
        file.flush().await.expect("the staged file should flush");

        assert!(staged.path().starts_with(&directories.area));
        assert!(!try_exists(&committed).await.unwrap_or(true));

        staged.commit().await.expect("the blob should commit");

        assert!(try_exists(&committed).await.unwrap_or(false));
        assert!(!try_exists(staged.path()).await.unwrap_or(true));
    }

    #[tokio::test]
    async fn leaves_the_blob_tree_untouched_when_a_staged_blob_is_discarded() {
        let directories = Directories::create();
        let staged = stage_blob(&directories.area, &directories.blobs);
        staged
            .create()
            .await
            .expect("the staged file should open")
            .flush()
            .await
            .expect("the staged file should flush");

        staged.discard().await;

        assert!(!try_exists(staged.path()).await.unwrap_or(true));
        assert!(!try_exists(&directories.blobs).await.unwrap_or(true));
    }
    #[test]
    fn clears_the_upload_area_and_nothing_else() {
        let directories = Directories::create();
        let work = directories.root.join("work");
        for area in [directories.area.clone(), work.join("1").join("separation")] {
            std::fs::create_dir_all(&area).expect("the area should be created");
            std::fs::write(area.join("file"), "staged").expect("the file should be written");
        }

        clear_upload_area(&work);

        assert!(!directories.area.exists());
        assert!(work.join("1").join("separation").join("file").exists());
    }
}
