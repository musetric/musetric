use std::path::{Path, PathBuf};

#[must_use]
pub fn blob_path(blobs_path: &Path, blob_id: &str) -> PathBuf {
    let level1 = blob_id.get(0..2).unwrap_or(blob_id);
    let level2 = blob_id.get(2..4).unwrap_or_default();
    blobs_path.join(level1).join(level2).join(blob_id)
}
