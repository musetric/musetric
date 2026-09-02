use std::path::{Path, PathBuf};

use rusqlite::{Connection, Result};

const REFERENCED_BLOB_IDS: &str = "SELECT blobId FROM AudioMaster
     UNION ALL SELECT blobId FROM AudioDelivery
     UNION ALL SELECT waveBlobId AS blobId FROM AudioDelivery
     UNION ALL SELECT blobId FROM Recording
     UNION ALL SELECT waveBlobId AS blobId FROM Recording
     UNION ALL SELECT blobId FROM Preview
     UNION ALL SELECT blobId FROM Subtitle
     UNION ALL SELECT blobId FROM Rhythm
     UNION ALL SELECT blobId FROM Key
     UNION ALL SELECT blobId FROM Chords";

#[must_use]
pub fn blob_path(blobs_path: &Path, blob_id: &str) -> PathBuf {
    let level1 = blob_id.get(0..2).unwrap_or(blob_id);
    let level2 = blob_id.get(2..4).unwrap_or_default();
    blobs_path.join(level1).join(level2).join(blob_id)
}

pub(crate) fn read_referenced_blob_ids(connection: &Connection) -> Result<Vec<String>> {
    let mut statement = connection.prepare(REFERENCED_BLOB_IDS)?;
    let rows = statement.query_map([], |row| row.get(0))?;
    rows.collect()
}
