use std::path::{Path, PathBuf};

use musetric_db::{BoxedError, blob_path};
use tokio::fs::{File, create_dir_all, remove_file};
use uuid::Uuid;

pub(crate) struct BlobRef {
    pub(crate) blob_id: String,
    pub(crate) path: PathBuf,
}

pub(crate) fn create_blob_ref(blobs_path: &Path) -> BlobRef {
    let blob_id = Uuid::new_v4().to_string();
    let path = blob_path(blobs_path, &blob_id);
    BlobRef { blob_id, path }
}

pub(crate) async fn create_blob_file(reference: &BlobRef) -> Result<File, BoxedError> {
    if let Some(directory) = reference.path.parent() {
        create_dir_all(directory).await?;
    }
    Ok(File::create(&reference.path).await?)
}

pub(crate) async fn discard_blob(blobs_path: &Path, blob_id: &str) {
    let _ = remove_file(blob_path(blobs_path, blob_id)).await;
}
