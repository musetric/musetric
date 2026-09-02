use std::sync::Arc;

use axum::Router;
use musetric_jobs::Queue;

use crate::{
    frontend::Frontend, proxy, proxy::ProxyState, realtime::Rooms, routes, routes::RouteState,
    storage::Storage,
};

pub(crate) struct RouterOptions {
    pub(crate) proxy: ProxyState,
    pub(crate) frontend: Frontend,
    pub(crate) storage: Arc<Storage>,
    pub(crate) queue: Arc<Queue>,
}

pub(crate) fn create_router(options: RouterOptions) -> Router {
    let state = RouteState {
        proxy: options.proxy.clone(),
        rooms: Arc::new(Rooms::create()),
        storage: options.storage,
        queue: options.queue,
    };
    routes::create_router(state).merge(proxy::create_router(options.proxy, options.frontend))
}
