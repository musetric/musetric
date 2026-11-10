use std::time::Duration;

use axum::{
    body::Bytes,
    extract::ws::{Message, WebSocket},
};
use tokio::{
    sync::{mpsc::UnboundedReceiver, watch},
    time::{Instant, Interval, MissedTickBehavior, interval_at},
};

use crate::realtime::events;

pub(crate) const CLOSE_GOING_AWAY: u16 = 1001;
pub(crate) const CLOSE_UNSUPPORTED: u16 = 1003;
pub(crate) const CLOSE_POLICY: u16 = 1008;
pub(crate) const CLOSE_INTERNAL: u16 = 1011;

#[derive(Clone, Copy)]
pub(crate) struct Heartbeat {
    pub(crate) interval: Duration,
    pub(crate) silence: Duration,
}

pub(crate) const HEARTBEAT: Heartbeat = Heartbeat {
    interval: Duration::from_secs(5),
    silence: Duration::from_secs(15),
};

pub(crate) struct Channel {
    socket: WebSocket,
    outgoing: UnboundedReceiver<Message>,
    beats: Interval,
    silence: Duration,
    heard: Instant,
}

impl Channel {
    pub(crate) fn create(
        socket: WebSocket,
        outgoing: UnboundedReceiver<Message>,
        heartbeat: Heartbeat,
    ) -> Self {
        let mut beats = interval_at(Instant::now() + heartbeat.interval, heartbeat.interval);
        beats.set_missed_tick_behavior(MissedTickBehavior::Delay);
        Self {
            socket,
            outgoing,
            beats,
            silence: heartbeat.silence,
            heard: Instant::now(),
        }
    }

    pub(crate) async fn receive(&mut self, closing: &mut watch::Receiver<bool>) -> Option<Message> {
        loop {
            let message = tokio::select! {
                received = self.socket.recv() => {
                    self.heard = Instant::now();
                    return received.and_then(Result::ok);
                }
                queued = self.outgoing.recv() => queued?,
                _ = self.beats.tick() => {
                    if self.heard.elapsed() >= self.silence {
                        return None;
                    }
                    Message::Ping(Bytes::new())
                }
                _ = closing.wait_for(|closed| *closed) => return None,
            };
            if self.socket.send(message).await.is_err() {
                return None;
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

    pub(crate) async fn flush(&mut self) {
        while let Ok(message) = self.outgoing.try_recv() {
            if self.socket.send(message).await.is_err() {
                return;
            }
        }
    }
}
