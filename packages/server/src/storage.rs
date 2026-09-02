use std::{path::PathBuf, sync::Arc};

use musetric_db::{BoxedError, Reader, Writer};
use musetric_media::Tools;
use tokio::task::spawn_blocking;

use crate::failure::Failure;

pub(crate) struct Storage {
    pub(crate) database: Reader,
    pub(crate) writer: Writer,
    pub(crate) blobs_path: PathBuf,
    pub(crate) tools: Tools,
}

pub(crate) async fn read_database<Value>(
    storage: &Arc<Storage>,
    query: impl FnOnce(&Reader) -> Result<Value, BoxedError> + Send + 'static,
) -> Result<Value, BoxedError>
where
    Value: Send + 'static,
{
    let owned = Arc::clone(storage);
    spawn_blocking(move || query(&owned.database)).await?
}

pub(crate) async fn write_database<Value>(
    storage: &Arc<Storage>,
    change: impl FnOnce(&Writer) -> Result<Value, BoxedError> + Send + 'static,
) -> Result<Value, BoxedError>
where
    Value: Send + 'static,
{
    let owned = Arc::clone(storage);
    spawn_blocking(move || change(&owned.writer)).await?
}

pub(crate) async fn read<Value>(
    storage: &Arc<Storage>,
    query: impl FnOnce(&Reader) -> Result<Value, BoxedError> + Send + 'static,
) -> Result<Value, Failure>
where
    Value: Send + 'static,
{
    read_database(storage, query).await.map_err(Failure::failed)
}

pub(crate) async fn write<Value>(
    storage: &Arc<Storage>,
    change: impl FnOnce(&Writer) -> Result<Value, BoxedError> + Send + 'static,
) -> Result<Value, Failure>
where
    Value: Send + 'static,
{
    write_database(storage, change)
        .await
        .map_err(Failure::failed)
}
