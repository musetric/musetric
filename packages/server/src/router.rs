use std::sync::Arc;

use axum::Router;
use musetric_jobs::Queue;

use crate::{
    frontend, frontend::Frontend, realtime::Rooms, routes, routes::RouteState, storage::Storage,
};

pub(crate) struct RouterOptions {
    pub(crate) frontend: Frontend,
    pub(crate) storage: Arc<Storage>,
    pub(crate) queue: Arc<Queue>,
}

pub(crate) fn create_router(options: RouterOptions) -> Router {
    let state = RouteState {
        rooms: Arc::new(Rooms::create()),
        storage: options.storage,
        queue: options.queue,
    };
    routes::create_router(state).merge(frontend::create_router(options.frontend))
}
