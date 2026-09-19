use std::{path::PathBuf, sync::Arc};

use axum::Router;
use musetric_jobs::Queue;

use crate::{
    frontend, frontend::Frontend, realtime::Rooms, routes, routes::RouteState, storage::Storage,
};

pub(crate) struct RouterOptions {
    pub(crate) frontend: Frontend,
    pub(crate) storage: Arc<Storage>,
    pub(crate) queue: Arc<Queue>,
    pub(crate) models_path: PathBuf,
}

pub(crate) fn create_router(options: RouterOptions) -> Router {
    let state = RouteState {
        rooms: Arc::new(Rooms::create()),
        storage: options.storage,
        queue: options.queue,
        models_path: options.models_path,
    };
    routes::create_router(state).merge(frontend::create_router(options.frontend))
}
