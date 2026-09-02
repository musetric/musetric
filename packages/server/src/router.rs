use std::sync::Arc;

use axum::{Router, http::Uri};

use crate::{analysis, proxy, proxy::ProxyState, storage::Storage};

pub(crate) fn create_router(upstream: Uri, storage: Arc<Storage>) -> Router {
    let state = ProxyState::create(upstream);
    analysis::create_router(state.clone(), storage).merge(proxy::create_router(state))
}
