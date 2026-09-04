use std::sync::Arc;

use axum::{
    Router,
    extract::{State, WebSocketUpgrade, ws::Message},
    response::{IntoResponse, Response},
    routing::get,
};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;

use crate::{page_bridge::PageBridge, routes::RouteState};

pub(crate) fn create_router() -> Router<RouteState> {
    Router::new().route("/api/pages", get(upgrade))
}

async fn upgrade(State(state): State<RouteState>, upgrade: WebSocketUpgrade) -> Response {
    let pages = Arc::clone(&state.pages);
    upgrade
        .on_upgrade(move |socket| serve(socket, pages))
        .into_response()
}

async fn serve(socket: axum::extract::ws::WebSocket, pages: Arc<PageBridge>) {
    let (outgoing, mut receiver) = mpsc::unbounded_channel();
    pages.attach(outgoing.clone());
    let (mut sink, mut stream) = socket.split();
    let sending = async {
        while let Some(line) = receiver.recv().await {
            if sink.send(Message::text(line)).await.is_err() {
                break;
            }
        }
    };
    let reading = async {
        while let Some(Ok(message)) = stream.next().await {
            if let Message::Text(text) = message {
                pages.accept(text.as_str());
            }
        }
    };
    tokio::select! {
        () = sending => {}
        () = reading => {}
    }
    pages.detach(&outgoing);
}
