use axum::{
    Router,
    body::Body,
    extract::{DefaultBodyLimit, Multipart, Path, State},
    response::Response,
    routing::{get, post},
};
use musetric_db::{MasterType, ProjectItem, Reader, StemLoudness, blob_path};
use musetric_media::{
    ENCODER_DELAY, Mixdown, MixdownChange, MixdownChannels, MixdownFormat, MixdownGroup,
    MixdownTrack, SampleDepth, write_mixdown,
};
use serde::Deserialize;
use serde_json::json;

use crate::{
    analysis::read_gains,
    blob_response::{NamedFile, send_named},
    blobs::upload_area,
    failure::{Failure, finish, invalid_number},
    form::{Field, Form, UploadTarget, UploadedFile, read_form},
    mixdown::MixdownFile,
    routes::{
        RouteState,
        item::{json_response, missing_message},
    },
    storage::read,
};

const UPLOAD_LIMIT: usize = 200 * 1024 * 1024;
const FORMAT_FIELD: &str = "format";
const VOLUMES_FIELD: &str = "volumes";
const PLAYBACK_FIELD: &str = "playback";
const LABEL_FIELD: &str = "label";
const RECORDING_FIELD: &str = "recording";
const PROJECT_ID: &str = "projectId";
const INVALID_BODY: &str = "body Invalid mixdown request";
const KILOBIT: u32 = 1000;
const BITRATES: [u32; 3] = [128, 192, 256];
const TEMPO_PERCENTS: std::ops::RangeInclusive<usize> = 20..=200;
const TEMPO_PERCENT_STEP: usize = 5;
const SEMITONES: std::ops::RangeInclusive<i32> = -6..=6;
const OCTAVES: std::ops::RangeInclusive<i32> = -1..=1;
const SEMITONES_PER_OCTAVE: i32 = 12;
const LABEL_LENGTH: usize = 120;
const STEMS: [MasterType; 3] = [
    MasterType::Lead,
    MasterType::Backing,
    MasterType::Instrumental,
];

pub(crate) fn create_router() -> Router<RouteState> {
    Router::new()
        .route("/api/project/{projectId}/mixdown", post(handle_create))
        .route("/api/mixdown/{mixdownId}/content", get(handle_content))
        .layer(DefaultBodyLimit::max(UPLOAD_LIMIT))
}

#[derive(Deserialize)]
#[serde(tag = "format", rename_all = "lowercase")]
enum FormatBody {
    M4a {
        bitrate: u32,
    },
    Mp3 {
        bitrate: u32,
    },
    Flac {
        #[serde(rename = "bitDepth")]
        bit_depth: u8,
    },
    Wav {
        #[serde(rename = "bitDepth")]
        bit_depth: u8,
    },
}

#[derive(Deserialize)]
struct Volumes {
    lead: f32,
    backing: f32,
    instrumental: f32,
    recording: f32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Playback {
    tempo_ratio: f64,
    transpose_semitones: i32,
    lead_octave: i32,
}

struct MixdownRequest<'form> {
    format: FormatBody,
    volumes: Volumes,
    playback: Playback,
    label: &'form str,
    recording: Option<&'form UploadedFile>,
}

struct SongAudio {
    project: ProjectItem,
    stems: Vec<Option<String>>,
    loudness: Vec<StemLoudness>,
}

async fn handle_create(
    State(state): State<RouteState>,
    Path(raw_project_id): Path<String>,
    multipart: Multipart,
) -> Response<Body> {
    let Ok(project_id) = raw_project_id.parse::<i64>() else {
        return finish(Err(invalid_number(PROJECT_ID)));
    };
    let area = upload_area(&state.storage.work_path);
    let target = UploadTarget {
        area: &area,
        blobs_path: &state.storage.blobs_path,
    };
    let form = match read_form(multipart, target).await {
        Ok(form) => form,
        Err(failure) => return finish(Err(failure)),
    };
    let created = match read_request(&form) {
        Ok(request) => create(&state, project_id, request).await,
        Err(failure) => Err(failure),
    };
    form.discard().await;
    finish(created.map(|mixdown_id| json_response(&json!({ "mixdownId": mixdown_id }))))
}

fn read_request(form: &Form) -> Result<MixdownRequest<'_>, Failure> {
    let invalid = || Failure::Invalid(INVALID_BODY.to_owned());
    let Field::Text(format) = form.field(FORMAT_FIELD) else {
        return Err(invalid());
    };
    let Field::Text(volumes) = form.field(VOLUMES_FIELD) else {
        return Err(invalid());
    };
    let Field::Text(playback) = form.field(PLAYBACK_FIELD) else {
        return Err(invalid());
    };
    let Field::Text(label) = form.field(LABEL_FIELD) else {
        return Err(invalid());
    };
    let recording = match form.field(RECORDING_FIELD) {
        Field::Missing => None,
        Field::File(file) => Some(file),
        Field::Text(_) => return Err(invalid()),
    };
    Ok(MixdownRequest {
        format: serde_json::from_str(format).map_err(|_| invalid())?,
        volumes: serde_json::from_str(volumes).map_err(|_| invalid())?,
        playback: serde_json::from_str(playback).map_err(|_| invalid())?,
        label,
        recording,
    })
}

async fn handle_content(
    State(state): State<RouteState>,
    Path(mixdown_id): Path<String>,
) -> Response<Body> {
    let Some(file) = state.mixdowns.find(&mixdown_id) else {
        return finish(Err(Failure::NotFound(format!(
            "Mixdown {mixdown_id} not found"
        ))));
    };
    finish(
        send_named(NamedFile {
            missing_message: format!("Mixdown file for id {mixdown_id} not found"),
            path: file.path,
            filename: file.filename,
            content_type: file.content_type,
        })
        .await,
    )
}

async fn create(
    state: &RouteState,
    project_id: i64,
    request: MixdownRequest<'_>,
) -> Result<String, Failure> {
    let format = read_format(&request.format)?;
    let change = read_change(&request.playback)?;
    let label = read_label(request.label)?;
    let audio = read(&state.storage, move |reader| read_audio(reader, project_id))
        .await?
        .ok_or_else(|| Failure::NotFound(missing_message(project_id)))?;
    let mut mixdown = plan(state, &audio, &request.volumes, Target { format, change })?;
    if let Some(recording) = request.recording {
        let delay = usize::try_from(ENCODER_DELAY).map_err(Failure::failed)?;
        mixdown.tracks.push(MixdownTrack {
            from: recording.staged.path().to_path_buf(),
            gain: read_volume(request.volumes.recording)?,
            channels: MixdownChannels::Mono,
            lead_in: change.frame_count(delay),
            group: MixdownGroup::Ready,
        });
    }
    let (mixdown_id, path) = state.mixdowns.reserve().await.map_err(Failure::failed)?;
    write_mixdown(state.storage.pcm.as_ref(), mixdown, &path)
        .await
        .map_err(Failure::failed)?;
    let (extension, content_type) = describe(format);
    let filename = format!("{} ({label}).{extension}", audio.project.name);
    state.mixdowns.register(
        mixdown_id.clone(),
        MixdownFile::create(path, filename, content_type),
    );
    Ok(mixdown_id)
}

fn read_audio(
    reader: &Reader,
    project_id: i64,
) -> Result<Option<SongAudio>, musetric_db::BoxedError> {
    let Some(project) = reader.project(project_id)? else {
        return Ok(None);
    };
    let stems = STEMS
        .iter()
        .map(|stem| reader.master_blob(project_id, *stem))
        .collect::<Result<_, _>>()?;
    Ok(Some(SongAudio {
        project,
        stems,
        loudness: reader.stem_loudness(project_id)?,
    }))
}

fn read_format(body: &FormatBody) -> Result<MixdownFormat, Failure> {
    match body {
        FormatBody::M4a { bitrate } if BITRATES.contains(bitrate) => Ok(MixdownFormat::M4a {
            bitrate: bitrate * KILOBIT,
        }),
        FormatBody::Mp3 { bitrate } if BITRATES.contains(bitrate) => Ok(MixdownFormat::Mp3 {
            bitrate: bitrate * KILOBIT,
        }),
        FormatBody::Flac { bit_depth } => read_depth(*bit_depth).map(MixdownFormat::Flac),
        FormatBody::Wav { bit_depth } => read_depth(*bit_depth).map(MixdownFormat::Wav),
        FormatBody::M4a { .. } | FormatBody::Mp3 { .. } => {
            Err(Failure::Invalid(INVALID_BODY.to_owned()))
        }
    }
}

fn read_depth(bit_depth: u8) -> Result<SampleDepth, Failure> {
    match bit_depth {
        16 => Ok(SampleDepth::Sixteen),
        24 => Ok(SampleDepth::TwentyFour),
        _ => Err(Failure::Invalid(INVALID_BODY.to_owned())),
    }
}

#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "the ratio is checked to lie in 0.2..=2 before the percent is taken"
)]
fn read_change(playback: &Playback) -> Result<MixdownChange, Failure> {
    let invalid = || Failure::Invalid(INVALID_BODY.to_owned());
    let percent = (playback.tempo_ratio * 100.0).round();
    if !(0.2..=2.0).contains(&playback.tempo_ratio)
        || (playback.tempo_ratio * 100.0 - percent).abs() > 1e-6
    {
        return Err(invalid());
    }
    let tempo_percent = percent as usize;
    if !TEMPO_PERCENTS.contains(&tempo_percent)
        || !tempo_percent.is_multiple_of(TEMPO_PERCENT_STEP)
        || !SEMITONES.contains(&playback.transpose_semitones)
        || !OCTAVES.contains(&playback.lead_octave)
    {
        return Err(invalid());
    }
    Ok(MixdownChange {
        tempo_percent,
        semitones: playback.transpose_semitones,
        lead_semitones: playback.transpose_semitones + SEMITONES_PER_OCTAVE * playback.lead_octave,
    })
}

fn read_label(label: &str) -> Result<&str, Failure> {
    let trimmed = label.trim();
    if trimmed.is_empty() || trimmed.chars().count() > LABEL_LENGTH {
        return Err(Failure::Invalid(INVALID_BODY.to_owned()));
    }
    Ok(trimmed)
}

fn read_volume(volume: f32) -> Result<f32, Failure> {
    if (0.0..=1.0).contains(&volume) {
        return Ok(volume);
    }
    Err(Failure::Invalid(INVALID_BODY.to_owned()))
}

#[derive(Clone, Copy)]
struct Target {
    format: MixdownFormat,
    change: MixdownChange,
}

fn plan(
    state: &RouteState,
    audio: &SongAudio,
    volumes: &Volumes,
    target: Target,
) -> Result<Mixdown, Failure> {
    let stem_scale = db_to_gain(read_gains(&audio.loudness).map_or(0.0, |gains| gains.source));
    let stem_volumes = [volumes.lead, volumes.backing, volumes.instrumental];
    let mut tracks = Vec::new();
    for ((stem, blob), volume) in STEMS.iter().zip(&audio.stems).zip(stem_volumes) {
        let blob_id = blob
            .as_ref()
            .ok_or_else(|| Failure::NotFound(format!("Audio master {} not found", stem.name())))?;
        tracks.push(MixdownTrack {
            from: blob_path(&state.storage.blobs_path, blob_id),
            gain: read_volume(volume)? * stem_scale,
            channels: MixdownChannels::Stereo,
            lead_in: 0,
            group: if *stem == MasterType::Lead
                && target.change.lead_semitones != target.change.semitones
            {
                MixdownGroup::Lead
            } else {
                MixdownGroup::Song
            },
        });
    }
    Ok(Mixdown {
        sample_rate: u32::try_from(audio.project.sample_rate).map_err(Failure::failed)?,
        frame_count: usize::try_from(audio.project.frame_count).map_err(Failure::failed)?,
        tracks,
        format: target.format,
        change: target.change,
    })
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "a gain of a few dozen decibels is far inside the f32 range"
)]
fn db_to_gain(decibels: f64) -> f32 {
    10_f64.powf(decibels / 20.0) as f32
}

const fn describe(format: MixdownFormat) -> (&'static str, &'static str) {
    match format {
        MixdownFormat::M4a { .. } => ("m4a", "audio/mp4"),
        MixdownFormat::Mp3 { .. } => ("mp3", "audio/mpeg"),
        MixdownFormat::Flac(_) => ("flac", "audio/flac"),
        MixdownFormat::Wav(_) => ("wav", "audio/wav"),
    }
}

#[cfg(test)]
mod tests {
    use musetric_media::MixdownChange;

    use super::{Playback, read_change, read_label};

    const fn playback(tempo_ratio: f64, transpose_semitones: i32, lead_octave: i32) -> Playback {
        Playback {
            tempo_ratio,
            transpose_semitones,
            lead_octave,
        }
    }

    #[test]
    fn reads_the_tempo_as_a_percent_and_the_lead_octave_as_semitones() {
        assert_eq!(
            read_change(&playback(0.95, 1, -1)).ok(),
            Some(MixdownChange {
                tempo_percent: 95,
                semitones: 1,
                lead_semitones: -11,
            })
        );
        assert_eq!(
            read_change(&playback(1.0, 0, 0)).ok(),
            Some(MixdownChange::ORIGINAL)
        );
    }

    #[test]
    fn refuses_values_the_player_cannot_reach() {
        for wrong in [
            playback(0.33, 0, 0),
            playback(2.05, 0, 0),
            playback(0.15, 0, 0),
            playback(1.0, 7, 0),
            playback(1.0, 0, 2),
        ] {
            assert!(read_change(&wrong).is_err());
        }
    }

    #[test]
    fn trims_the_label_and_refuses_an_empty_one() {
        assert_eq!(read_label("  cover  ").ok(), Some("cover"));
        assert!(read_label("   ").is_err());
        assert!(read_label(&"x".repeat(121)).is_err());
    }
}
