use std::sync::Arc;

use axum::Router;
use musetric_gpu::ExecutorHost;
use musetric_jobs::Queue;

use crate::serve::ExecutorSurface;

use crate::{
    frontend, frontend::Frontend, realtime::Rooms, routes, routes::RouteState, storage::Storage,
};

pub(crate) struct RouterOptions {
    pub(crate) frontend: Frontend,
    pub(crate) storage: Arc<Storage>,
    pub(crate) queue: Arc<Queue>,
    pub(crate) executor: Arc<ExecutorHost>,
    pub(crate) executor_surface: ExecutorSurface,
}

pub(crate) fn create_router(options: RouterOptions) -> Router {
    let state = RouteState {
        rooms: Arc::new(Rooms::create()),
        storage: options.storage,
        queue: options.queue,
        executor: options.executor,
        executor_surface: options.executor_surface,
    };
    routes::create_router(state).merge(frontend::create_router(options.frontend))
}
