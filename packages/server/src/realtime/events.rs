use axum::extract::ws::{CloseFrame, Message, Utf8Bytes};
use serde_json::{Value, json};

pub(crate) fn text(event: &Value) -> Message {
    Message::Text(Utf8Bytes::from(event.to_string()))
}

pub(crate) fn close(code: u16, reason: &str) -> Message {
    Message::Close(Some(CloseFrame {
        code,
        reason: Utf8Bytes::from(reason.to_owned()),
    }))
}

pub(crate) fn recording_started() -> Value {
    json!({ "type": "recording.started" })
}

pub(crate) fn recording_finished() -> Value {
    json!({ "type": "recording.finished" })
}

pub(crate) fn peaks_changed(start_peak_index: usize, peaks: &[f32]) -> Value {
    json!({
        "type": "recording.peaksChanged",
        "startPeakIndex": start_peak_index,
        "peaks": peaks,
    })
}

pub(crate) fn failed(error: &str) -> Value {
    json!({ "type": "error", "error": error })
}

pub(crate) fn player_started(recording: bool) -> Value {
    let name = if recording {
        "player.record"
    } else {
        "player.play"
    };
    json!({ "type": name })
}

pub(crate) fn player_stopped() -> Value {
    json!({ "type": "player.stop" })
}

pub(crate) fn player_revision(revision: i64) -> Value {
    json!({ "type": "player.revision", "revision": revision })
}

pub(crate) fn player_frame_index(
    frame_index: f64,
    frozen: bool,
    revision: i64,
    from_user: bool,
) -> Value {
    let source = if from_user { "user" } else { "playback" };
    json!({
        "type": "player.frameIndex",
        "frameIndex": frame_index,
        "frozen": frozen,
        "revision": revision,
        "source": source,
    })
}

pub(crate) struct PlayerSyncState {
    pub(crate) active: bool,
    pub(crate) recording: bool,
    pub(crate) frozen: bool,
    pub(crate) frame_index: f64,
    pub(crate) revision: i64,
}

pub(crate) fn player_sync_state(state: &PlayerSyncState) -> Value {
    json!({
        "type": "player.sync.state",
        "active": state.active,
        "recording": state.recording,
        "frozen": state.frozen,
        "frameIndex": state.frame_index,
        "revision": state.revision,
    })
}
