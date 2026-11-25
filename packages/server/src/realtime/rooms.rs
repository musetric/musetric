use std::{
    collections::HashMap,
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use axum::extract::ws::Message;
use serde_json::Value;
use tokio::sync::{
    mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel},
    watch,
};

use crate::realtime::{
    channel::{HEARTBEAT, Heartbeat},
    events,
};

pub(crate) type MemberId = u64;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Begin {
    Started,
    Saving,
    Busy,
}

struct Room {
    members: HashMap<MemberId, UnboundedSender<Message>>,
    session_owner: Option<MemberId>,
    saving: bool,
}

impl Room {
    fn create() -> Self {
        Self {
            members: HashMap::new(),
            session_owner: None,
            saving: false,
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
    closing: watch::Sender<bool>,
    live: watch::Sender<usize>,
    heartbeat: Heartbeat,
}

pub(crate) struct Live<'rooms>(&'rooms watch::Sender<usize>);

impl Drop for Live<'_> {
    fn drop(&mut self) {
        self.0.send_modify(|count| *count -= 1);
    }
}

impl Rooms {
    pub(crate) fn create() -> Self {
        Self::with_heartbeat(HEARTBEAT)
    }

    pub(crate) fn with_heartbeat(heartbeat: Heartbeat) -> Self {
        Self {
            projects: Mutex::new(HashMap::new()),
            next_member: AtomicU64::new(0),
            closing: watch::Sender::new(false),
            live: watch::Sender::new(0),
            heartbeat,
        }
    }

    pub(crate) const fn heartbeat(&self) -> Heartbeat {
        self.heartbeat
    }

    pub(crate) fn enter(&self) -> Live<'_> {
        self.live.send_modify(|count| *count += 1);
        Live(&self.live)
    }

    pub(crate) fn closing(&self) -> watch::Receiver<bool> {
        self.closing.subscribe()
    }

    pub(crate) fn is_closing(&self) -> bool {
        *self.closing.borrow()
    }

    pub(crate) async fn close(&self) {
        self.closing.send_replace(true);
        let mut live = self.live.subscribe();
        let _ = live.wait_for(|count| *count == 0).await;
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
        forget_idle_room(&mut projects, project_id);
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

    pub(crate) fn begin_session(&self, project_id: i64, member: MemberId) -> Begin {
        let started = self.with_room(project_id, |room| match room.session_owner {
            Some(_) if room.saving => Begin::Saving,
            Some(_) => Begin::Busy,
            None => {
                room.session_owner = Some(member);
                Begin::Started
            }
        });
        started.unwrap_or(Begin::Busy)
    }

    pub(crate) fn begin_edit(&self, project_id: i64) -> Option<MemberId> {
        let editor = self.next_member.fetch_add(1, Ordering::Relaxed);
        let mut projects = self.lock();
        let room = projects.entry(project_id).or_insert_with(Room::create);
        if room.session_owner.is_some() {
            return None;
        }
        room.session_owner = Some(editor);
        room.saving = true;
        Some(editor)
    }

    pub(crate) fn save_session(&self, project_id: i64, member: MemberId) {
        self.in_room(project_id, |room| {
            if room.session_owner == Some(member) {
                room.saving = true;
            }
        });
    }

    pub(crate) fn end_session(&self, project_id: i64, member: MemberId) {
        let mut projects = self.lock();
        let Some(room) = projects.get_mut(&project_id) else {
            return;
        };
        if room.session_owner == Some(member) {
            room.session_owner = None;
            room.saving = false;
        }
        forget_idle_room(&mut projects, project_id);
    }

    #[cfg(test)]
    pub(crate) fn holds_unsaved_session(&self, project_id: i64) -> bool {
        self.with_room(project_id, |room| {
            room.session_owner.is_some() && !room.saving
        })
        .unwrap_or(false)
    }

    fn with_room<Value>(
        &self,
        project_id: i64,
        run: impl FnOnce(&mut Room) -> Value,
    ) -> Option<Value> {
        self.lock().get_mut(&project_id).map(run)
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

fn forget_idle_room(projects: &mut HashMap<i64, Room>, project_id: i64) {
    let idle = projects
        .get(&project_id)
        .is_some_and(|room| room.members.is_empty() && room.session_owner.is_none());
    if idle {
        projects.remove(&project_id);
    }
}
