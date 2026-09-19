use musetric_db::Analysis;
use serde::Deserialize;
use serde_json::Value;

const CHORD_FRAME_SECONDS: f64 = 2048.0 / 22050.0;
const RHYTHM_FRAME_SECONDS: f64 = 1.0 / 50.0;
const SUBTITLE_FRAME_SECONDS: f64 = 0.02;
const PITCH_CLASSES: [&str; 12] = [
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];
const MAJOR: &str = "maj";
const LABELED_QUALITIES: [&str; 13] = [
    "min", "dim", "aug", "min6", "maj6", "min7", "minmaj7", "maj7", "7", "dim7", "hdim7", "sus2",
    "sus4",
];
const KEY_MODES: [&str; 2] = ["major", "minor"];
const KEY_ROOTS: [&str; 12] = [
    "A", "Bb", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#",
];
const NO_CHORD: &str = "N";
const UNKNOWN_CHORD: &str = "X";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Rhythm {
    bpm: f64,
    beats: Vec<f64>,
    downbeats: Vec<f64>,
    meter: u32,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ChordSegment {
    start: f64,
    end: f64,
    label: String,
    root: String,
    quality: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Chords {
    segments: Vec<ChordSegment>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Key {
    root: String,
    mode: String,
    confidence: f64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Word {
    #[expect(dead_code, reason = "read to hold the result to its shape")]
    text: String,
    start: f64,
    end: f64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SubtitleSegment {
    #[expect(dead_code, reason = "read to hold the result to its shape")]
    text: String,
    start: f64,
    end: f64,
    words: Vec<Word>,
}

pub(crate) fn check_result(
    analysis: Analysis,
    result: &Value,
    duration: f64,
) -> Result<(), String> {
    let checked = match analysis {
        Analysis::Rhythm => read(result).and_then(|rhythm| check_rhythm(&rhythm, duration)),
        Analysis::Chords => read(result).and_then(|chords| check_chords(&chords, duration)),
        Analysis::Key => read(result).and_then(|key| check_key(&key)),
        Analysis::Subtitle => read::<Vec<SubtitleSegment>>(result)
            .and_then(|segments| check_subtitles(&segments, duration)),
    };
    checked.map_err(|reason| format!("The {} result is invalid: {reason}", name(analysis)))
}

const fn name(analysis: Analysis) -> &'static str {
    match analysis {
        Analysis::Rhythm => "rhythm",
        Analysis::Chords => "chords",
        Analysis::Key => "key",
        Analysis::Subtitle => "transcription",
    }
}

fn read<T: for<'de> Deserialize<'de>>(result: &Value) -> Result<T, String> {
    T::deserialize(result).map_err(|error| error.to_string())
}

fn check_rhythm(rhythm: &Rhythm, duration: f64) -> Result<(), String> {
    if rhythm.beats.len() < 2 {
        return Err("the tempo could not be determined: fewer than two beats".to_owned());
    }
    if !rhythm.bpm.is_finite() || rhythm.bpm <= 0.0 {
        return Err(format!(
            "the tempo could not be determined: {} bpm",
            rhythm.bpm
        ));
    }
    if rhythm.downbeats.len() < 2 {
        return Err("the meter could not be determined: fewer than two downbeats".to_owned());
    }
    if rhythm.meter == 0 {
        return Err("the meter is zero".to_owned());
    }
    let limit = duration + RHYTHM_FRAME_SECONDS;
    check_times("beat", &rhythm.beats, limit)?;
    check_times("downbeat", &rhythm.downbeats, limit)?;
    if let Some(stray) = rhythm
        .downbeats
        .iter()
        .find(|downbeat| !rhythm.beats.contains(downbeat))
    {
        return Err(format!("the downbeat at {stray} s is not a beat"));
    }
    Ok(())
}

fn check_chords(chords: &Chords, duration: f64) -> Result<(), String> {
    let limit = duration + CHORD_FRAME_SECONDS;
    let mut previous_end = 0.0;
    for segment in &chords.segments {
        check_span("chord", segment.start, segment.end, limit)?;
        if segment.start < previous_end {
            return Err(format!(
                "the chord at {} s overlaps the one before",
                segment.start
            ));
        }
        previous_end = segment.end;
        check_chord_label(segment)?;
    }
    Ok(())
}

fn check_chord_label(segment: &ChordSegment) -> Result<(), String> {
    let label = segment.label.as_str();
    let known = if label == NO_CHORD || label == UNKNOWN_CHORD {
        segment.root == label && segment.quality.is_none()
    } else {
        let (root, quality) = match label.split_once(':') {
            Some((root, quality)) if LABELED_QUALITIES.contains(&quality) => (root, quality),
            Some(_) => {
                return Err(format!(
                    "the chord label {label} is not in the model vocabulary"
                ));
            }
            None => (label, MAJOR),
        };
        PITCH_CLASSES.contains(&root)
            && segment.root == root
            && segment.quality.as_deref() == Some(quality)
    };
    if known {
        Ok(())
    } else {
        Err(format!(
            "the chord label {label} is not in the model vocabulary"
        ))
    }
}

fn check_key(key: &Key) -> Result<(), String> {
    if !KEY_ROOTS.contains(&key.root.as_str()) {
        return Err(format!(
            "the key root {} is not in the model vocabulary",
            key.root
        ));
    }
    if !KEY_MODES.contains(&key.mode.as_str()) {
        return Err(format!("the key mode {} is not major or minor", key.mode));
    }
    if !(0.0..=1.0).contains(&key.confidence) {
        return Err(format!(
            "the confidence {} is not a probability",
            key.confidence
        ));
    }
    Ok(())
}

fn check_subtitles(segments: &[SubtitleSegment], duration: f64) -> Result<(), String> {
    let limit = duration + SUBTITLE_FRAME_SECONDS;
    for segment in segments {
        check_span("subtitle", segment.start, segment.end, limit)?;
        for word in &segment.words {
            check_span("word", word.start, word.end, limit)?;
        }
    }
    Ok(())
}

fn check_times(name: &str, times: &[f64], limit: f64) -> Result<(), String> {
    let mut previous = f64::NEG_INFINITY;
    for &time in times {
        check_time(name, time, limit)?;
        if time <= previous {
            return Err(format!("the {name} at {time} s is out of order"));
        }
        previous = time;
    }
    Ok(())
}

fn check_span(name: &str, start: f64, end: f64, limit: f64) -> Result<(), String> {
    check_time(name, start, limit)?;
    check_time(name, end, limit)?;
    if end < start {
        return Err(format!("the {name} at {start} s ends before it starts"));
    }
    Ok(())
}

fn check_time(name: &str, time: f64, limit: f64) -> Result<(), String> {
    if (0.0..=limit).contains(&time) {
        Ok(())
    } else {
        Err(format!("the {name} time {time} s is outside the audio"))
    }
}
