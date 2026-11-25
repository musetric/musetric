use axum::extract::ws::{CloseFrame, Message, Utf8Bytes};
use serde_json::{Value, json};

use crate::{
    realtime::session::HeldRun,
    recording::{RecordingSummary, TakeFormat},
};

pub(crate) fn text(event: &Value) -> Message {
    Message::Text(Utf8Bytes::from(event.to_string()))
}

pub(crate) fn close(code: u16, reason: &str) -> Message {
    Message::Close(Some(CloseFrame {
        code,
        reason: Utf8Bytes::from(reason.to_owned()),
    }))
}

pub(crate) fn recording_started(session_id: &str, recording_id: i64, format: &TakeFormat) -> Value {
    json!({
        "type": "recording.started",
        "sessionId": session_id,
        "recordingId": recording_id,
        "tempo": format.tempo,
        "transpose": format.transpose,
        "octave": format.octave,
    })
}

pub(crate) fn recording_resumed(session_id: &str, recording_id: i64, runs: &[HeldRun]) -> Value {
    let held: Vec<Value> = runs
        .iter()
        .map(|run| json!({ "startFrame": run.start_frame, "frameCount": run.frame_count }))
        .collect();
    json!({
        "type": "recording.resumed",
        "sessionId": session_id,
        "recordingId": recording_id,
        "runs": held,
    })
}

pub(crate) fn recording_finished(session_id: &str) -> Value {
    json!({ "type": "recording.finished", "sessionId": session_id })
}

pub(crate) fn recording_changed(recording_id: i64) -> Value {
    json!({ "type": "recording.changed", "recordingId": recording_id })
}

pub(crate) fn recording_item(recording: &RecordingSummary) -> Value {
    json!({
        "id": recording.id,
        "name": recording.name,
        "active": recording.active,
        "canUndo": recording.history.can_undo,
        "canRedo": recording.history.can_redo,
        "empty": recording.empty,
        "lost": recording.lost,
    })
}

pub(crate) fn recording_list(recordings: &[RecordingSummary]) -> Value {
    let listed: Vec<Value> = recordings.iter().map(recording_item).collect();
    json!({ "type": "recording.list", "recordings": listed })
}

pub(crate) fn peaks_changed(recording_id: i64, start_peak_index: usize, peaks: &[f32]) -> Value {
    json!({
        "type": "recording.peaksChanged",
        "recordingId": recording_id,
        "startPeakIndex": start_peak_index,
        "peaks": peaks,
    })
}

pub(crate) fn failed(error: &str) -> Value {
    json!({ "type": "error", "error": error })
}
