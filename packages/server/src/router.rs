use std::sync::Arc;

use axum::{Router, http::Uri};

use crate::{proxy, proxy::ProxyState, realtime::Rooms, routes, storage::Storage};

pub(crate) fn create_router(upstream: Uri, storage: Arc<Storage>) -> Router {
    let state = ProxyState::create(upstream);
    let rooms = Arc::new(Rooms::create());
    routes::create_router(state.clone(), rooms, storage).merge(proxy::create_router(state))
}
