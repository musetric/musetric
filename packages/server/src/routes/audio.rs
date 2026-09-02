use std::sync::Arc;

use axum::{
    Router,
    body::Body,
    extract::{Path, State},
    http::{HeaderMap, Request},
    response::Response,
    routing::get,
};
use musetric_db::{MasterType, StemType};

use crate::{
    blob_response::{CachedBlob, StoredBlob, send_cached, send_generated, send_stored},
    failure::{Failure, finish},
    proxy::forward,
    routes::RouteState,
    storage::{Storage, read},
    wav,
};

const FLAC_FORMAT: &str = "flac";
const FLAC_CONTENT_TYPE: &str = "audio/flac";
const FMP4_FORMAT: &str = "mp4";
const FMP4_CONTENT_TYPE: &str = "audio/mp4";
const PEAKS_CONTENT_TYPE: &str = "application/octet-stream";
const PEAKS_FILENAME: &str = "waveform.bin";
const PEAK_COUNT: usize = 3840;
const PEAK_BYTE_LENGTH: usize = PEAK_COUNT * 2 * size_of::<f32>();

pub(crate) fn create_router() -> Router<RouteState> {
    Router::new()
        .route(
            "/api/audio/project/{projectId}/master/{type}/content",
            get(master_content),
        )
        .route(
            "/api/audio/project/{projectId}/delivery/{stemType}/content",
            get(delivery_content),
        )
        .route(
            "/api/audio/project/{projectId}/delivery/{stemType}/wave",
            get(delivery_wave),
        )
        .route(
            "/api/audio/project/{projectId}/recording/content",
            get(recording_content),
        )
        .route(
            "/api/audio/project/{projectId}/recording/wave",
            get(recording_wave),
        )
}

async fn master_content(
    State(state): State<RouteState>,
    Path((raw_project_id, raw_type)): Path<(String, String)>,
    request: Request<Body>,
) -> Response<Body> {
    let (Ok(project_id), Some(master)) =
        (raw_project_id.parse::<i64>(), MasterType::parse(&raw_type))
    else {
        return forward(&state.proxy, request).await;
    };
    finish(send_master(&state.storage, project_id, master, request.headers()).await)
}

async fn delivery_content(
    State(state): State<RouteState>,
    Path((raw_project_id, raw_stem)): Path<(String, String)>,
    request: Request<Body>,
) -> Response<Body> {
    let (Ok(project_id), Some(stem)) = (raw_project_id.parse::<i64>(), StemType::parse(&raw_stem))
    else {
        return forward(&state.proxy, request).await;
    };
    finish(send_delivery(&state.storage, project_id, stem, request.headers()).await)
}

async fn delivery_wave(
    State(state): State<RouteState>,
    Path((raw_project_id, raw_stem)): Path<(String, String)>,
    request: Request<Body>,
) -> Response<Body> {
    let (Ok(project_id), Some(stem)) = (raw_project_id.parse::<i64>(), StemType::parse(&raw_stem))
    else {
        return forward(&state.proxy, request).await;
    };
    finish(send_peaks(&state.storage, project_id, stem, request.headers()).await)
}

async fn recording_content(
    State(state): State<RouteState>,
    Path(raw_project_id): Path<String>,
    request: Request<Body>,
) -> Response<Body> {
    let Ok(project_id) = raw_project_id.parse::<i64>() else {
        return forward(&state.proxy, request).await;
    };
    finish(send_recording_content(&state.storage, project_id).await)
}

async fn recording_wave(
    State(state): State<RouteState>,
    Path(raw_project_id): Path<String>,
    request: Request<Body>,
) -> Response<Body> {
    let Ok(project_id) = raw_project_id.parse::<i64>() else {
        return forward(&state.proxy, request).await;
    };
    finish(send_recording_wave(&state.storage, project_id).await)
}

async fn send_master(
    storage: &Arc<Storage>,
    project_id: i64,
    master: MasterType,
    request: &HeaderMap,
) -> Result<Response<Body>, Failure> {
    let type_name = master.name();
    let (found_blob, found_project) = read(storage, move |database| {
        Ok((
            database.master_blob(project_id, master)?,
            database.project_name(project_id)?,
        ))
    })
    .await?;
    let blob_id = found_blob.ok_or_else(|| {
        Failure::NotFound(format!(
            "Audio master for project {project_id} and type {type_name} not found"
        ))
    })?;
    let project_name = found_project
        .ok_or_else(|| Failure::NotFound(format!("Project with id {project_id} not found")))?;
    let suffix = if master == MasterType::Source {
        String::new()
    } else {
        format!("_{type_name}")
    };
    let blob = CachedBlob {
        missing_message: format!("Audio master blob for id {blob_id} not found"),
        blob_id,
        filename: format!("{project_name}{suffix}.{FLAC_FORMAT}"),
        content_type: FLAC_CONTENT_TYPE.to_owned(),
    };
    send_cached(storage, request, blob).await
}

async fn send_delivery(
    storage: &Arc<Storage>,
    project_id: i64,
    stem: StemType,
    request: &HeaderMap,
) -> Result<Response<Body>, Failure> {
    let stem_name = stem.name();
    let (found_delivery, found_project) = read(storage, move |database| {
        Ok((
            database.delivery(project_id, stem)?,
            database.project_name(project_id)?,
        ))
    })
    .await?;
    let delivery = found_delivery.ok_or_else(|| {
        Failure::NotFound(format!(
            "Audio delivery for project {project_id} and stem type {stem_name} not found"
        ))
    })?;
    let project_name = found_project
        .ok_or_else(|| Failure::NotFound(format!("Project with id {project_id} not found")))?;
    let blob = CachedBlob {
        missing_message: format!("Audio delivery blob for id {} not found", delivery.blob_id),
        blob_id: delivery.blob_id,
        filename: format!("{project_name}_{stem_name}.{FMP4_FORMAT}"),
        content_type: FMP4_CONTENT_TYPE.to_owned(),
    };
    send_cached(storage, request, blob).await
}

async fn send_peaks(
    storage: &Arc<Storage>,
    project_id: i64,
    stem: StemType,
    request: &HeaderMap,
) -> Result<Response<Body>, Failure> {
    let stem_name = stem.name();
    let found = read(storage, move |database| database.delivery(project_id, stem)).await?;
    let delivery = found.ok_or_else(|| {
        Failure::NotFound(format!(
            "Wave peaks for project {project_id} and stem type {stem_name} not found"
        ))
    })?;
    let blob = CachedBlob {
        missing_message: format!("Wave peaks blob for id {} not found", delivery.wave_blob_id),
        blob_id: delivery.wave_blob_id,
        filename: PEAKS_FILENAME.to_owned(),
        content_type: PEAKS_CONTENT_TYPE.to_owned(),
    };
    send_cached(storage, request, blob).await
}

async fn send_recording_content(
    storage: &Arc<Storage>,
    project_id: i64,
) -> Result<Response<Body>, Failure> {
    let found = read(storage, move |database| database.recording(project_id)).await?;
    let Some(recording) = found else {
        return Ok(send_generated(wav::CONTENT_TYPE, wav::create_empty()));
    };
    let blob = StoredBlob {
        missing_message: format!(
            "Recording audio blob for id {} not found",
            recording.blob_id
        ),
        blob_id: recording.blob_id,
        content_type: wav::CONTENT_TYPE,
    };
    send_stored(storage, blob).await
}

async fn send_recording_wave(
    storage: &Arc<Storage>,
    project_id: i64,
) -> Result<Response<Body>, Failure> {
    let found = read(storage, move |database| database.recording(project_id)).await?;
    let Some(recording) = found else {
        return Ok(send_generated(
            PEAKS_CONTENT_TYPE,
            vec![0; PEAK_BYTE_LENGTH],
        ));
    };
    let blob = StoredBlob {
        missing_message: format!(
            "Recording wave blob for id {} not found",
            recording.wave_blob_id
        ),
        blob_id: recording.wave_blob_id,
        content_type: PEAKS_CONTENT_TYPE,
    };
    send_stored(storage, blob).await
}
