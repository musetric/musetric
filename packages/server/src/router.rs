use std::sync::Arc;

use axum::Router;
use musetric_jobs::Queue;

use crate::{
    proxy, proxy::ProxyState, realtime::Rooms, routes, routes::RouteState, storage::Storage,
};

pub(crate) fn create_router(proxy: ProxyState, storage: Arc<Storage>, queue: Arc<Queue>) -> Router {
    let state = RouteState {
        proxy: proxy.clone(),
        rooms: Arc::new(Rooms::create()),
        storage,
        queue,
    };
    routes::create_router(state).merge(proxy::create_router(proxy))
}
