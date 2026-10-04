use axum::{
    Router,
    body::{Body, to_bytes},
    extract::{Path, State},
    http::Request,
    response::Response,
    routing::{get, post},
};
use musetric_db::{MasterType, ProjectItem, Reader, Recording, StemLoudness, blob_path};
use musetric_media::{
    ENCODER_DELAY, Mixdown, MixdownChannels, MixdownFormat, MixdownTrack, SampleDepth,
    write_mixdown,
};
use serde::Deserialize;
use serde_json::json;

use crate::{
    analysis::read_gains,
    blob_response::{NamedFile, send_named},
    failure::{Failure, finish, invalid_number},
    mixdown::MixdownFile,
    routes::{
        RouteState,
        item::{json_response, missing_message},
    },
    storage::read,
};

const BODY_LIMIT: usize = 4 * 1024;
const PROJECT_ID: &str = "projectId";
const INVALID_BODY: &str = "body Invalid mixdown request";
const KILOBIT: u32 = 1000;
const BITRATES: [u32; 3] = [128, 192, 256];
const STEMS: [MasterType; 3] = [
    MasterType::Lead,
    MasterType::Backing,
    MasterType::Instrumental,
];

pub(crate) fn create_router() -> Router<RouteState> {
    Router::new()
        .route("/api/project/{projectId}/mixdown", post(handle_create))
        .route("/api/mixdown/{mixdownId}/content", get(handle_content))
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
struct MixdownBody {
    #[serde(flatten)]
    format: FormatBody,
    volumes: Volumes,
}

struct SongAudio {
    project: ProjectItem,
    stems: Vec<Option<String>>,
    recording: Option<Recording>,
    loudness: Vec<StemLoudness>,
}

async fn handle_create(
    State(state): State<RouteState>,
    Path(raw_project_id): Path<String>,
    request: Request<Body>,
) -> Response<Body> {
    let Ok(project_id) = raw_project_id.parse::<i64>() else {
        return finish(Err(invalid_number(PROJECT_ID)));
    };
    let payload = match to_bytes(request.into_body(), BODY_LIMIT).await {
        Ok(payload) => payload,
        Err(error) => return finish(Err(Failure::failed(error))),
    };
    let Ok(body) = serde_json::from_slice::<MixdownBody>(&payload) else {
        return finish(Err(Failure::Invalid(INVALID_BODY.to_owned())));
    };
    finish(
        create(&state, project_id, body)
            .await
            .map(|mixdown_id| json_response(&json!({ "mixdownId": mixdown_id }))),
    )
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

async fn create(state: &RouteState, project_id: i64, body: MixdownBody) -> Result<String, Failure> {
    let format = read_format(&body.format)?;
    let audio = read(&state.storage, move |reader| read_audio(reader, project_id))
        .await?
        .ok_or_else(|| Failure::NotFound(missing_message(project_id)))?;
    let mixdown = plan(state, &audio, &body.volumes, format)?;
    let (mixdown_id, path) = state.mixdowns.reserve().await.map_err(Failure::failed)?;
    write_mixdown(state.storage.pcm.as_ref(), mixdown, &path)
        .await
        .map_err(Failure::failed)?;
    let (extension, content_type) = describe(format);
    let filename = format!("{} (mix).{extension}", audio.project.name);
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
        recording: reader.recording(project_id)?,
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

fn read_volume(volume: f32) -> Result<f32, Failure> {
    if (0.0..=1.0).contains(&volume) {
        return Ok(volume);
    }
    Err(Failure::Invalid(INVALID_BODY.to_owned()))
}

fn plan(
    state: &RouteState,
    audio: &SongAudio,
    volumes: &Volumes,
    format: MixdownFormat,
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
        });
    }
    if let Some(recording) = &audio.recording {
        tracks.push(MixdownTrack {
            from: blob_path(&state.storage.blobs_path, &recording.blob_id),
            gain: read_volume(volumes.recording)?,
            channels: MixdownChannels::Mono,
            lead_in: usize::try_from(ENCODER_DELAY).map_err(Failure::failed)?,
        });
    }
    Ok(Mixdown {
        sample_rate: u32::try_from(audio.project.sample_rate).map_err(Failure::failed)?,
        frame_count: usize::try_from(audio.project.frame_count).map_err(Failure::failed)?,
        tracks,
        format,
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
