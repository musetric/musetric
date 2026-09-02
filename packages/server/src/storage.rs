use std::path::PathBuf;

use musetric_db::Reader;

pub(crate) struct Storage {
    pub(crate) database: Reader,
    pub(crate) blobs_path: PathBuf,
}
