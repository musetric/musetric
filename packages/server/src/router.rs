use std::sync::Arc;

use axum::{Router, http::Uri};

use crate::{proxy, proxy::ProxyState, routes, storage::Storage};

pub(crate) fn create_router(upstream: Uri, storage: Arc<Storage>) -> Router {
    let state = ProxyState::create(upstream);
    routes::create_router(state.clone(), storage).merge(proxy::create_router(state))
}
