use axum::extract::ws::{Message, WebSocket};
use tokio::sync::mpsc::UnboundedReceiver;

use crate::realtime::events;

pub(crate) const CLOSE_UNSUPPORTED: u16 = 1003;
pub(crate) const CLOSE_POLICY: u16 = 1008;
pub(crate) const CLOSE_INTERNAL: u16 = 1011;

pub(crate) struct Channel {
    socket: WebSocket,
    outgoing: UnboundedReceiver<Message>,
}

impl Channel {
    pub(crate) fn create(socket: WebSocket, outgoing: UnboundedReceiver<Message>) -> Self {
        Self { socket, outgoing }
    }

    pub(crate) async fn receive(&mut self) -> Option<Message> {
        loop {
            tokio::select! {
                received = self.socket.recv() => {
                    return received.and_then(Result::ok);
                }
                queued = self.outgoing.recv() => {
                    let message = queued?;
                    if self.socket.send(message).await.is_err() {
                        return None;
                    }
                }
            }
        }
    }

    pub(crate) async fn fail(&mut self, reason: &str) {
        self.flush().await;
        let _ = self
            .socket
            .send(events::text(&events::failed(reason)))
            .await;
        self.close(CLOSE_INTERNAL, reason).await;
    }

    pub(crate) async fn close(&mut self, code: u16, reason: &str) {
        self.flush().await;
        let _ = self.socket.send(events::close(code, reason)).await;
    }

    async fn flush(&mut self) {
        while let Ok(message) = self.outgoing.try_recv() {
            if self.socket.send(message).await.is_err() {
                return;
            }
        }
    }
}
