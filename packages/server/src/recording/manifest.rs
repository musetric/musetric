use std::{path::Path, sync::Arc};

use musetric_db::{BoxedError, RecordingLayer, RecordingPiece};
use serde::{Deserialize, Serialize};
use tokio::{
    fs::{OpenOptions, read, read_dir, rename, write},
    io::AsyncWriteExt,
};

use crate::{
    blobs::{StagedBlob, close_area, read_project_area_id, recording_area, staged_blob},
    recording::store::{FinishedTake, TakeRun, commit_take, refresh_peaks},
    storage::{Storage, read_database},
    wav::{BYTES_PER_SAMPLE, HEADER_BYTE_LENGTH, create_header},
};

const MANIFEST: &str = "take.json";
const NEXT_MANIFEST: &str = "take.json.next";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TakeManifest {
    pub(crate) take_id: String,
    pub(crate) recording_id: i64,
    pub(crate) sample_rate: i64,
    pub(crate) tempo: f64,
    pub(crate) transpose: i64,
    pub(crate) octave: i64,
    pub(crate) runs: Vec<ManifestRun>,
    pub(crate) published: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManifestRun {
    pub(crate) blob_id: String,
    pub(crate) start_frame: i64,
    pub(crate) frame_count: i64,
}

pub(crate) async fn write_manifest(area: &Path, manifest: &TakeManifest) -> Result<(), BoxedError> {
    let next = area.join(NEXT_MANIFEST);
    write(&next, serde_json::to_vec(manifest)?).await?;
    rename(&next, area.join(MANIFEST)).await?;
    Ok(())
}

async fn read_manifest(area: &Path) -> Option<TakeManifest> {
    let bytes = read(area.join(MANIFEST)).await.ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub(crate) async fn recover_takes(storage: &Arc<Storage>) {
    let Ok(mut entries) = read_dir(&storage.work_path).await else {
        return;
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        let Some(project_id) = read_project_area_id(&entry.path()) else {
            continue;
        };
        let area = recording_area(&storage.work_path, project_id);
        let Some(manifest) = read_manifest(&area).await else {
            continue;
        };
        if recover_take(storage, &area, manifest).await.is_ok() {
            close_area(&area).await;
        }
    }
}

async fn recover_take(
    storage: &Arc<Storage>,
    area: &Path,
    manifest: TakeManifest,
) -> Result<(), BoxedError> {
    let recording_id = manifest.recording_id;
    let stored = read_database(storage, move |database| {
        database.recording_pieces(recording_id)
    })
    .await?;
    if stored
        .iter()
        .any(|piece| manifest.published.contains(&piece.blob_id))
    {
        return Ok(());
    }
    let mut runs = Vec::with_capacity(manifest.runs.len());
    for run in &manifest.runs {
        let blob = staged_blob(area, &storage.blobs_path, run.blob_id.clone());
        let frame_count = settle_run(&blob, run.frame_count, manifest.sample_rate).await?;
        if frame_count == 0 {
            continue;
        }
        runs.push(TakeRun {
            piece: RecordingPiece {
                blob_id: run.blob_id.clone(),
                layer: RecordingLayer::Fresh,
                song_start_frame: run.start_frame,
                frame_count,
                tempo: manifest.tempo,
                transpose: manifest.transpose,
                octave: manifest.octave,
            },
            blob,
        });
    }
    if runs.is_empty() {
        return Ok(());
    }
    let take = FinishedTake {
        area,
        runs,
        manifest: Some(manifest),
    };
    commit_take(storage, recording_id, take).await?;
    refresh_peaks(storage, recording_id).await;
    Ok(())
}

async fn settle_run(
    blob: &StagedBlob,
    frame_count: i64,
    sample_rate: i64,
) -> Result<i64, BoxedError> {
    if !blob.reclaim().await? {
        return Ok(0);
    }
    let mut audio = OpenOptions::new().write(true).open(blob.path()).await?;
    let header_length = u64::try_from(HEADER_BYTE_LENGTH)?;
    let sample_length = u64::from(BYTES_PER_SAMPLE);
    let length = audio.metadata().await?.len();
    let on_disk = i64::try_from(length.saturating_sub(header_length) / sample_length)?;
    let frames = frame_count.min(on_disk);
    audio
        .set_len(header_length + u64::try_from(frames)? * sample_length)
        .await?;
    audio
        .write_all(&create_header(
            u32::try_from(frames)?,
            u32::try_from(sample_rate)?,
        ))
        .await?;
    audio.flush().await?;
    Ok(frames)
}
