use std::{collections::HashMap, path::Path, sync::Arc};

use musetric_db::{BoxedError, NewRecording, Recording, RecordingLayer, RecordingPiece, blob_path};
use musetric_media::WAVE_PEAK_COUNT;
use tokio::fs::{read as read_file, rename, try_exists, write as write_file};

use crate::{
    blobs::{StagedBlob, stage_blob},
    publish::publish,
    recording::plan::{PlannedPiece, base_pieces, fresh_piece, keep_base, merge_fresh},
    storage::{Storage, read_database, write_database},
    wav::{HEADER_BYTE_LENGTH, create_header},
};

const FULL_SCALE: f64 = 32768.0;
const PEAK_BYTE_LENGTH: usize = WAVE_PEAK_COUNT * 2 * 4;
const MISSING_RECORDING: &str = "The recording of this project is missing";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct History {
    pub(crate) can_undo: bool,
    pub(crate) can_redo: bool,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct TakeFormat {
    pub(crate) sample_rate: i64,
    pub(crate) frame_count: i64,
}

pub(crate) struct FinishedTake<'area> {
    pub(crate) area: &'area Path,
    pub(crate) blob: StagedBlob,
    pub(crate) piece: RecordingPiece,
}

pub(crate) struct Composite {
    pub(crate) sample_rate: i64,
    pub(crate) samples: Vec<i16>,
}

type PcmCache = HashMap<String, Vec<i16>>;

async fn read_state(
    storage: &Arc<Storage>,
    project_id: i64,
) -> Result<Option<(Recording, Vec<RecordingPiece>)>, BoxedError> {
    read_database(storage, move |database| {
        let Some(recording) = database.recording(project_id)? else {
            return Ok(None);
        };
        let pieces = database.recording_pieces(project_id)?;
        Ok(Some((recording, pieces)))
    })
    .await
}

fn history_of(recording: &Recording, pieces: &[RecordingPiece]) -> History {
    let has_fresh = fresh_piece(pieces).is_some();
    History {
        can_undo: has_fresh && recording.fresh_applied,
        can_redo: has_fresh && !recording.fresh_applied,
    }
}

pub(crate) async fn read_history(
    storage: &Arc<Storage>,
    project_id: i64,
) -> Result<History, BoxedError> {
    Ok(read_state(storage, project_id)
        .await?
        .map(|(recording, pieces)| history_of(&recording, &pieces))
        .unwrap_or_default())
}

async fn read_pcm(storage: &Arc<Storage>, blob_id: &str) -> Result<Option<Vec<i16>>, BoxedError> {
    let bytes = match read_file(blob_path(&storage.blobs_path, blob_id)).await {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    Ok(Some(
        bytes
            .get(HEADER_BYTE_LENGTH..)
            .unwrap_or_default()
            .chunks_exact(2)
            .map(|pair| i16::from_le_bytes([pair[0], pair[1]]))
            .collect(),
    ))
}

async fn load_pcm(
    storage: &Arc<Storage>,
    mut blob_ids: Vec<String>,
) -> Result<PcmCache, BoxedError> {
    blob_ids.sort_unstable();
    blob_ids.dedup();
    let mut cache = PcmCache::with_capacity(blob_ids.len());
    for blob_id in blob_ids {
        if let Some(pcm) = read_pcm(storage, &blob_id).await? {
            cache.insert(blob_id, pcm);
        }
    }
    Ok(cache)
}

async fn present_pieces(
    storage: &Arc<Storage>,
    pieces: Vec<RecordingPiece>,
) -> Result<Vec<RecordingPiece>, BoxedError> {
    let mut present = Vec::with_capacity(pieces.len());
    for piece in pieces {
        if try_exists(blob_path(&storage.blobs_path, &piece.blob_id)).await? {
            present.push(piece);
        }
    }
    Ok(present)
}

fn sounding<'piece>(
    recording: &Recording,
    pieces: &'piece [RecordingPiece],
) -> Vec<&'piece RecordingPiece> {
    pieces
        .iter()
        .filter(|piece| piece.layer == RecordingLayer::Base)
        .chain(fresh_piece(pieces).filter(|_| recording.fresh_applied))
        .collect()
}

fn place(samples: &mut [i16], piece: &RecordingPiece, source: &[i16]) {
    let Ok(start) = usize::try_from(piece.song_start_frame) else {
        return;
    };
    let target = samples.get_mut(start..).unwrap_or_default();
    let count = target.len().min(source.len());
    target[..count].copy_from_slice(&source[..count]);
}

fn render(frame_count: i64, layers: &[&RecordingPiece], pcm: &PcmCache) -> Vec<i16> {
    let mut samples = vec![0_i16; usize::try_from(frame_count).unwrap_or(0)];
    for piece in layers {
        if let Some(source) = pcm.get(&piece.blob_id) {
            place(&mut samples, piece, source);
        }
    }
    samples
}

async fn compose(
    storage: &Arc<Storage>,
    recording: &Recording,
    pieces: &[RecordingPiece],
) -> Result<Vec<i16>, BoxedError> {
    let blob_ids = sounding(recording, pieces)
        .iter()
        .map(|piece| piece.blob_id.clone())
        .collect();
    let pcm = load_pcm(storage, blob_ids).await?;
    Ok(render(
        recording.frame_count,
        &sounding(recording, pieces),
        &pcm,
    ))
}

pub(crate) async fn read_composite(
    storage: &Arc<Storage>,
    project_id: i64,
) -> Result<Option<Composite>, BoxedError> {
    let Some((recording, pieces)) = read_state(storage, project_id).await? else {
        return Ok(None);
    };
    let samples = compose(storage, &recording, &pieces).await?;
    Ok(Some(Composite {
        sample_rate: recording.sample_rate,
        samples,
    }))
}

pub(crate) fn encode_wav(composite: &Composite) -> Result<Vec<u8>, BoxedError> {
    let mut bytes = create_header(
        u32::try_from(composite.samples.len())?,
        u32::try_from(composite.sample_rate)?,
    );
    bytes.reserve(composite.samples.len() * 2);
    for sample in &composite.samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    Ok(bytes)
}

#[expect(
    clippy::cast_precision_loss,
    reason = "the peak segment calculation is the TypeScript recorder's floating-point protocol"
)]
pub(crate) fn frames_per_peak(frame_count: i64) -> f64 {
    (frame_count as f64 / WAVE_PEAK_COUNT as f64).max(1.0)
}

#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "the peak index is floored with JavaScript number semantics"
)]
pub(crate) fn peak_index(frame: f64, frames_per_peak: f64) -> usize {
    (frame / frames_per_peak).floor().max(0.0) as usize
}

pub(crate) fn sample_value(sample: i16) -> f32 {
    #[expect(
        clippy::cast_possible_truncation,
        reason = "the TypeScript recorder stores peaks in a Float32Array"
    )]
    let value = (f64::from(sample) / FULL_SCALE) as f32;
    value
}

#[expect(
    clippy::cast_precision_loss,
    reason = "frame positions stay far below 2^53"
)]
fn measure_peaks(samples: &[i16]) -> Vec<f32> {
    let step = frames_per_peak(i64::try_from(samples.len()).unwrap_or(i64::MAX));
    let mut peaks = vec![0.0_f32; WAVE_PEAK_COUNT * 2];
    let mut last_index = None;
    for (frame, sample) in samples.iter().enumerate() {
        let index = peak_index(frame as f64, step);
        if index >= WAVE_PEAK_COUNT {
            break;
        }
        let value = sample_value(*sample);
        let base = index * 2;
        if last_index != Some(index) {
            peaks[base] = value;
            peaks[base + 1] = value;
            last_index = Some(index);
        }
        peaks[base] = peaks[base].min(value);
        peaks[base + 1] = peaks[base + 1].max(value);
    }
    peaks
}

fn encode_peaks(peaks: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(peaks.len() * 4);
    for peak in peaks {
        bytes.extend_from_slice(&peak.to_le_bytes());
    }
    bytes
}

async fn write_peaks(storage: &Arc<Storage>, project_id: i64) -> Result<(), BoxedError> {
    let (recording, pieces) = read_state(storage, project_id)
        .await?
        .ok_or(MISSING_RECORDING)?;
    let samples = compose(storage, &recording, &pieces).await?;
    let path = blob_path(&storage.blobs_path, &recording.wave_blob_id);
    let staged = path.with_extension("next");
    write_file(&staged, encode_peaks(&measure_peaks(&samples))).await?;
    rename(&staged, &path).await?;
    Ok(())
}

async fn refresh_peaks(storage: &Arc<Storage>, project_id: i64) {
    let _ = write_peaks(storage, project_id).await;
}

pub(crate) async fn ensure_recording(
    storage: &Arc<Storage>,
    area: &Path,
    project_id: i64,
    format: TakeFormat,
) -> Result<Recording, BoxedError> {
    let existing = read_database(storage, move |database| database.recording(project_id)).await?;
    if let Some(recording) = existing {
        return Ok(recording);
    }
    let wave = stage_blob(area, &storage.blobs_path);
    wave.create().await?;
    write_file(wave.path(), vec![0_u8; PEAK_BYTE_LENGTH]).await?;
    let recording = NewRecording {
        project_id,
        wave_blob_id: wave.blob_id().to_owned(),
        sample_rate: format.sample_rate,
        frame_count: format.frame_count,
    };
    let created = Recording {
        wave_blob_id: recording.wave_blob_id.clone(),
        sample_rate: format.sample_rate,
        frame_count: format.frame_count,
        fresh_applied: true,
    };
    publish(storage, &[&wave], move |writer| {
        writer.create_recording(&recording)
    })
    .await?;
    Ok(created)
}

async fn write_planned(
    blob: &StagedBlob,
    plan: &PlannedPiece,
    pcm: &PcmCache,
    sample_rate: i64,
) -> Result<(), BoxedError> {
    let mut bytes = create_header(
        u32::try_from(plan.frame_count)?,
        u32::try_from(sample_rate)?,
    );
    for source in &plan.sources {
        let samples = pcm.get(&source.blob_id).ok_or(MISSING_RECORDING)?;
        let start = usize::try_from(source.start_frame)?;
        let end = start + usize::try_from(source.frame_count)?;
        for sample in samples.get(start..end).ok_or(MISSING_RECORDING)? {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
    }
    blob.create().await?;
    write_file(blob.path(), bytes).await?;
    Ok(())
}

pub(crate) async fn commit_take(
    storage: &Arc<Storage>,
    project_id: i64,
    take: FinishedTake<'_>,
) -> Result<History, BoxedError> {
    let (recording, stored) = read_state(storage, project_id)
        .await?
        .ok_or(MISSING_RECORDING)?;
    let pieces = present_pieces(storage, stored).await?;
    let base = base_pieces(&pieces);
    let planned = match fresh_piece(&pieces) {
        Some(fresh) if recording.fresh_applied => merge_fresh(&base, fresh),
        _ => keep_base(&base),
    };
    let source_ids: Vec<String> = planned
        .iter()
        .filter(|plan| plan.reused_blob(&pieces).is_none())
        .flat_map(|plan| plan.sources.iter().map(|source| source.blob_id.clone()))
        .collect();
    let pcm = load_pcm(storage, source_ids).await?;
    let mut staged = Vec::new();
    let mut next = Vec::with_capacity(planned.len() + 1);
    for plan in &planned {
        let blob_id = if let Some(reused) = plan.reused_blob(&pieces) {
            reused.to_owned()
        } else {
            let blob = stage_blob(take.area, &storage.blobs_path);
            write_planned(&blob, plan, &pcm, recording.sample_rate).await?;
            let blob_id = blob.blob_id().to_owned();
            staged.push(blob);
            blob_id
        };
        next.push(RecordingPiece {
            blob_id,
            layer: RecordingLayer::Base,
            song_start_frame: plan.song_start_frame,
            frame_count: plan.frame_count,
        });
    }
    next.push(take.piece);
    staged.push(take.blob);
    let committed: Vec<&StagedBlob> = staged.iter().collect();
    publish(storage, &committed, move |writer| {
        writer.replace_recording_pieces(project_id, &next, true)
    })
    .await?;
    refresh_peaks(storage, project_id).await;
    Ok(History {
        can_undo: true,
        can_redo: false,
    })
}

pub(crate) async fn set_fresh_applied(
    storage: &Arc<Storage>,
    project_id: i64,
    applied: bool,
) -> Result<Option<History>, BoxedError> {
    let Some((recording, pieces)) = read_state(storage, project_id).await? else {
        return Ok(None);
    };
    if fresh_piece(&pieces).is_none() || recording.fresh_applied == applied {
        return Ok(None);
    }
    write_database(storage, move |writer| {
        writer.set_recording_fresh_applied(project_id, applied)
    })
    .await?;
    refresh_peaks(storage, project_id).await;
    Ok(Some(History {
        can_undo: applied,
        can_redo: !applied,
    }))
}

#[cfg(test)]
mod tests {
    use musetric_db::{RecordingLayer, RecordingPiece};

    use super::{PcmCache, measure_peaks, render};

    #[test]
    fn layers_the_fresh_take_over_the_base() {
        let base = RecordingPiece {
            blob_id: "base".to_owned(),
            layer: RecordingLayer::Base,
            song_start_frame: 0,
            frame_count: 6,
        };
        let fresh = RecordingPiece {
            blob_id: "fresh".to_owned(),
            layer: RecordingLayer::Fresh,
            song_start_frame: 2,
            frame_count: 2,
        };
        let mut pcm = PcmCache::new();
        pcm.insert("base".to_owned(), vec![1; 6]);
        pcm.insert("fresh".to_owned(), vec![9; 2]);

        assert_eq!(render(8, &[&base], &pcm), [1, 1, 1, 1, 1, 1, 0, 0]);
        assert_eq!(render(8, &[&base, &fresh], &pcm), [1, 1, 9, 9, 1, 1, 0, 0]);
    }

    #[test]
    fn measures_peaks_per_segment() {
        let peaks = measure_peaks(&[0, 16384, -16384, 0]);

        assert!((peaks[0] - 0.0).abs() < f32::EPSILON);
        assert!((peaks[3] - 0.5).abs() < f32::EPSILON);
    }
}
