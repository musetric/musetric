use std::{
    collections::HashMap,
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use axum::extract::ws::Message;
use serde_json::Value;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};

use crate::realtime::events;

const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

pub(crate) type MemberId = u64;

pub(crate) struct FrameIndexUpdate {
    pub(crate) frame_index: f64,
    pub(crate) frozen: bool,
    pub(crate) revision: f64,
    pub(crate) from_user: bool,
}

struct Player {
    master: Option<MemberId>,
    active: bool,
    recording: bool,
    frozen: bool,
    frame_index: f64,
    revision: i64,
}

impl Player {
    fn create() -> Self {
        Self {
            master: None,
            active: false,
            recording: false,
            frozen: false,
            frame_index: 0.0,
            revision: 0,
        }
    }

    fn sync_state(&self) -> Value {
        events::player_sync_state(&events::PlayerSyncState {
            active: self.active,
            recording: self.recording,
            frozen: self.frozen,
            frame_index: self.frame_index,
            revision: self.revision,
        })
    }
}

struct Room {
    members: HashMap<MemberId, UnboundedSender<Message>>,
    player: Option<Player>,
    session_owner: Option<MemberId>,
}

impl Room {
    fn create() -> Self {
        Self {
            members: HashMap::new(),
            player: None,
            session_owner: None,
        }
    }

    fn send_to(&self, member: MemberId, event: &Value) {
        if let Some(sender) = self.members.get(&member) {
            let _ = sender.send(events::text(event));
        }
    }

    fn broadcast(&self, message: &Message, exclude: Option<MemberId>) {
        for (member, sender) in &self.members {
            if exclude == Some(*member) {
                continue;
            }
            let _ = sender.send(message.clone());
        }
    }

    fn broadcast_event(&self, event: &Value, exclude: Option<MemberId>) {
        self.broadcast(&events::text(event), exclude);
    }
}

pub(crate) struct Rooms {
    projects: Mutex<HashMap<i64, Room>>,
    next_member: AtomicU64,
}

impl Rooms {
    pub(crate) fn create() -> Self {
        Self {
            projects: Mutex::new(HashMap::new()),
            next_member: AtomicU64::new(0),
        }
    }

    pub(crate) fn join(&self, project_id: i64) -> (MemberId, UnboundedReceiver<Message>) {
        let member = self.next_member.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = unbounded_channel();
        self.lock()
            .entry(project_id)
            .or_insert_with(Room::create)
            .members
            .insert(member, sender);
        (member, receiver)
    }

    pub(crate) fn leave(&self, project_id: i64, member: MemberId) {
        let mut projects = self.lock();
        let Some(room) = projects.get_mut(&project_id) else {
            return;
        };
        room.members.remove(&member);
        let was_master = room
            .player
            .as_ref()
            .is_some_and(|player| player.master == Some(member));
        if was_master {
            stop_player(room);
        }
        if room.session_owner == Some(member) {
            room.session_owner = None;
        }
        if room.members.is_empty() {
            projects.remove(&project_id);
        }
    }

    pub(crate) fn send_to(&self, project_id: i64, member: MemberId, event: &Value) {
        self.in_room(project_id, |room| room.send_to(member, event));
    }

    pub(crate) fn broadcast_event(
        &self,
        project_id: i64,
        event: &Value,
        exclude: Option<MemberId>,
    ) {
        self.in_room(project_id, |room| room.broadcast_event(event, exclude));
    }

    pub(crate) fn broadcast_packet(&self, project_id: i64, packet: Vec<u8>, exclude: MemberId) {
        let message = Message::Binary(packet.into());
        self.in_room(project_id, |room| {
            room.broadcast(&message, Some(exclude));
        });
    }

    pub(crate) fn claim_master(&self, project_id: i64, member: MemberId, recording: bool) -> bool {
        let claimed = self.with_room(project_id, |room| {
            let player = room.player.get_or_insert_with(Player::create);
            if !player.active {
                player.master = Some(member);
                player.active = true;
                player.recording = recording;
                room.broadcast_event(&events::player_started(recording), Some(member));
                return true;
            }
            if player.master == Some(member) && player.recording == recording {
                return true;
            }
            let state = player.sync_state();
            room.send_to(member, &state);
            false
        });
        claimed.unwrap_or(false)
    }

    pub(crate) fn stop_player(&self, project_id: i64) {
        self.in_room(project_id, stop_player);
    }

    pub(crate) fn request_sync(&self, project_id: i64, member: MemberId) {
        self.in_room(project_id, |room| {
            let Some(player) = room.player.as_ref() else {
                return;
            };
            let state = player.sync_state();
            room.send_to(member, &state);
        });
    }

    pub(crate) fn set_frame_index(
        &self,
        project_id: i64,
        member: MemberId,
        update: &FrameIndexUpdate,
    ) {
        self.in_room(project_id, |room| {
            let Some(player) = room.player.as_mut() else {
                return;
            };
            if update.from_user {
                player.revision = (player.revision + 1) % MAX_SAFE_INTEGER;
                player.frame_index = update.frame_index;
                player.frozen = update.frozen;
                let revision = events::player_revision(player.revision);
                let moved = frame_index_event(player, true);
                room.send_to(member, &revision);
                room.broadcast_event(&moved, Some(member));
                return;
            }
            if !player.active || player.master != Some(member) {
                let state = player.sync_state();
                room.send_to(member, &state);
                return;
            }
            #[expect(
                clippy::cast_precision_loss,
                clippy::float_cmp,
                reason = "the client echoes the revision it was given, so only an exact match counts"
            )]
            if update.revision != player.revision as f64 {
                return;
            }
            player.frame_index = update.frame_index;
            player.frozen = update.frozen;
            let moved = frame_index_event(player, false);
            room.broadcast_event(&moved, Some(member));
        });
    }

    pub(crate) fn begin_session(&self, project_id: i64, member: MemberId) -> bool {
        let started = self.with_room(project_id, |room| {
            if room.session_owner.is_some() {
                return false;
            }
            room.session_owner = Some(member);
            true
        });
        started.unwrap_or(false)
    }

    pub(crate) fn end_session(&self, project_id: i64, member: MemberId) {
        self.in_room(project_id, |room| {
            if room.session_owner == Some(member) {
                room.session_owner = None;
            }
        });
    }

    fn with_room<Value>(
        &self,
        project_id: i64,
        run: impl FnOnce(&mut Room) -> Value,
    ) -> Option<Value> {
        self.lock().get_mut(&project_id).map(run)
    }

    #[cfg(test)]
    fn room_count(&self) -> usize {
        self.lock().len()
    }

    fn in_room(&self, project_id: i64, run: impl FnOnce(&mut Room)) {
        if let Some(room) = self.lock().get_mut(&project_id) {
            run(room);
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<i64, Room>> {
        self.projects
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

fn stop_player(room: &mut Room) {
    if let Some(player) = room.player.as_mut() {
        player.master = None;
        player.active = false;
        player.recording = false;
    }
    room.broadcast_event(&events::player_stopped(), None);
}

fn frame_index_event(player: &Player, from_user: bool) -> Value {
    events::player_frame_index(
        player.frame_index,
        player.frozen,
        player.revision,
        from_user,
    )
}

#[cfg(test)]
mod tests {
    use super::{Rooms, events};

    #[test]
    fn forgets_a_room_once_the_last_member_leaves() {
        let rooms = Rooms::create();
        let (member, _outgoing) = rooms.join(1);
        rooms.claim_master(1, member, false);
        rooms.leave(1, member);

        rooms.broadcast_event(1, &events::recording_finished(), None);
        rooms.send_to(1, member, &events::recording_finished());
        rooms.stop_player(1);
        rooms.request_sync(1, member);
        rooms.end_session(1, member);
        assert!(!rooms.claim_master(1, member, false));
        assert!(!rooms.begin_session(1, member));

        assert_eq!(rooms.room_count(), 0);
    }
}
