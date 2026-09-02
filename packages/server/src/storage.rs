use std::{path::PathBuf, sync::Arc};

use musetric_db::{BoxedError, Reader};
use tokio::task::spawn_blocking;

use crate::failure::Failure;

pub(crate) struct Storage {
    pub(crate) database: Reader,
    pub(crate) blobs_path: PathBuf,
}

pub(crate) async fn read<Value>(
    storage: &Arc<Storage>,
    query: impl FnOnce(&Reader) -> Result<Value, BoxedError> + Send + 'static,
) -> Result<Value, Failure>
where
    Value: Send + 'static,
{
    let owned = Arc::clone(storage);
    spawn_blocking(move || query(&owned.database))
        .await
        .map_err(Failure::failed)?
        .map_err(Failure::failed)
}
