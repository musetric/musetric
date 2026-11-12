use musetric_db::Analysis;
use serde_json::{Value, json};

use super::{CHORD_FRAME_SECONDS, check_result};

const CHORD_SAMPLE_RATE: f64 = 22050.0;
const CHORD_HOP: f64 = 2048.0;
const SAMPLES: f64 = 2.0 * CHORD_HOP + 1.0;

fn duration() -> f64 {
    SAMPLES / CHORD_SAMPLE_RATE
}

fn last_frame_end() -> f64 {
    (1.0 + (SAMPLES / CHORD_HOP).floor()) * CHORD_FRAME_SECONDS
}

fn round_to_millisecond(seconds: f64) -> f64 {
    (seconds * 1000.0).round() / 1000.0
}

fn chords_ending_at(end: f64) -> Value {
    json!({ "segments": [{ "start": 0.0, "end": end, "label": "N", "root": "N" }] })
}

#[test]
fn a_chord_end_rounded_past_the_last_frame_passes() {
    let end = round_to_millisecond(last_frame_end());
    assert!(last_frame_end() <= duration() + CHORD_FRAME_SECONDS);
    assert!(end > duration() + CHORD_FRAME_SECONDS);
    assert_eq!(
        check_result(Analysis::Chords, &chords_ending_at(end), duration()),
        Ok(())
    );
}

#[test]
fn a_chord_ending_a_millisecond_later_fails() {
    let end = round_to_millisecond(last_frame_end()) + 0.001;
    assert_eq!(
        check_result(Analysis::Chords, &chords_ending_at(end), duration()),
        Err(format!(
            "The chords result is invalid: the chord time {end} s is outside the audio"
        ))
    );
}
