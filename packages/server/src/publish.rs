use std::sync::Arc;

use musetric_db::{BoxedError, Writer};
use tokio::sync::{RwLock, RwLockWriteGuard};

use crate::{
    blobs::StagedBlob,
    storage::{Storage, write_database},
};

#[derive(Default)]
pub(crate) struct Publication {
    ordering: RwLock<()>,
}

pub(crate) async fn publish<Value>(
    storage: &Arc<Storage>,
    staged: &[&StagedBlob],
    change: impl FnOnce(&Writer) -> Result<Value, BoxedError> + Send + 'static,
) -> Result<Value, BoxedError>
where
    Value: Send + 'static,
{
    let _ordering = storage.publication.ordering.read().await;
    for blob in staged {
        blob.commit().await?;
    }
    write_database(storage, change).await
}

pub(crate) async fn hold_publications(storage: &Arc<Storage>) -> RwLockWriteGuard<'_, ()> {
    storage.publication.ordering.write().await
}
