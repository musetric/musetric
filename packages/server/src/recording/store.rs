use std::{collections::HashMap, path::Path, sync::Arc};

use musetric_db::{
    BoxedError, Recording, RecordingAudio, RecordingLayer, RecordingPiece, blob_path,
};
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
const MISSING_RECORDING: &str = "The recording is missing";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct History {
    pub(crate) can_undo: bool,
    pub(crate) can_redo: bool,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct TakeFormat {
    pub(crate) sample_rate: i64,
    pub(crate) frame_count: i64,
    pub(crate) tempo: f64,
}

pub(crate) struct FinishedTake<'area> {
    pub(crate) area: &'area Path,
    pub(crate) blob: StagedBlob,
    pub(crate) piece: RecordingPiece,
}

pub(crate) struct Sounding {
    pub(crate) sample_rate: i64,
    pub(crate) pieces: Vec<RecordingPiece>,
}

pub(crate) struct RecordingSummary {
    pub(crate) id: i64,
    pub(crate) name: String,
    pub(crate) active: bool,
    pub(crate) history: History,
    pub(crate) empty: bool,
}

type PcmCache = HashMap<String, Vec<i16>>;

async fn read_state(
    storage: &Arc<Storage>,
    recording_id: i64,
) -> Result<Option<(Recording, Vec<RecordingPiece>)>, BoxedError> {
    read_database(storage, move |database| {
        let Some(recording) = database.recording(recording_id)? else {
            return Ok(None);
        };
        let pieces = database.recording_pieces(recording_id)?;
        Ok(Some((recording, pieces)))
    })
    .await
}

async fn read_project_state(
    storage: &Arc<Storage>,
    project_id: i64,
    recording_id: i64,
) -> Result<Option<(Recording, Vec<RecordingPiece>)>, BoxedError> {
    Ok(read_state(storage, recording_id)
        .await?
        .filter(|(recording, _)| recording.project_id == project_id))
}

fn history_of(recording: &Recording, pieces: &[RecordingPiece]) -> History {
    let has_fresh = fresh_piece(pieces).is_some();
    History {
        can_undo: has_fresh && recording.fresh_applied,
        can_redo: has_fresh && !recording.fresh_applied,
    }
}

pub(crate) async fn read_recordings(
    storage: &Arc<Storage>,
    project_id: i64,
) -> Result<Vec<RecordingSummary>, BoxedError> {
    read_database(storage, move |database| {
        let mut summaries = Vec::new();
        for recording in database.recordings(project_id)? {
            let pieces = database.recording_pieces(recording.id)?;
            summaries.push(RecordingSummary {
                id: recording.id,
                history: history_of(&recording, &pieces),
                empty: sounding(&recording, &pieces).is_empty(),
                name: recording.name,
                active: recording.active,
            });
        }
        Ok(summaries)
    })
    .await
}

pub(crate) async fn is_active_recording(
    storage: &Arc<Storage>,
    project_id: i64,
    recording_id: i64,
) -> Result<bool, BoxedError> {
    Ok(
        read_database(storage, move |database| database.recording(recording_id))
            .await?
            .is_some_and(|recording| recording.project_id == project_id && recording.active),
    )
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

#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    reason = "frame positions stay far below 2^53 and are clamped to the song before indexing"
)]
fn place(samples: &mut [i16], piece: &RecordingPiece, source: &[i16]) {
    let start = piece.song_start_frame as f64;
    let end = start + piece.frame_count as f64 * piece.tempo;
    let first = start.max(0.0).ceil() as usize;
    let last = end.min(samples.len() as f64).ceil().max(0.0) as usize;
    for (offset, sample) in samples.iter_mut().enumerate().take(last).skip(first) {
        let recorded = ((offset as f64 - start) / piece.tempo).round() as usize;
        if let Some(value) = source.get(recorded) {
            *sample = *value;
        }
    }
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
    frame_count: i64,
    pieces: &[RecordingPiece],
) -> Result<Vec<i16>, BoxedError> {
    let blob_ids = sounding(recording, pieces)
        .iter()
        .map(|piece| piece.blob_id.clone())
        .collect();
    let pcm = load_pcm(storage, blob_ids).await?;
    Ok(render(frame_count, &sounding(recording, pieces), &pcm))
}

pub(crate) async fn read_sounding(
    storage: &Arc<Storage>,
    project_id: i64,
    recording_id: i64,
) -> Result<Option<Sounding>, BoxedError> {
    let Some((recording, pieces)) = read_project_state(storage, project_id, recording_id).await?
    else {
        return Ok(None);
    };
    let Some(audio) = recording.audio.as_ref() else {
        return Ok(Some(Sounding {
            sample_rate: 0,
            pieces: Vec::new(),
        }));
    };
    Ok(Some(Sounding {
        sample_rate: audio.sample_rate,
        pieces: sounding(&recording, &pieces).into_iter().cloned().collect(),
    }))
}

pub(crate) async fn read_wave_blob(
    storage: &Arc<Storage>,
    project_id: i64,
    recording_id: i64,
) -> Result<Option<Option<String>>, BoxedError> {
    Ok(read_project_state(storage, project_id, recording_id)
        .await?
        .map(|(recording, _)| recording.audio.map(|audio| audio.wave_blob_id)))
}

pub(crate) async fn holds_piece(
    storage: &Arc<Storage>,
    project_id: i64,
    recording_id: i64,
    blob_id: &str,
) -> Result<bool, BoxedError> {
    Ok(read_project_state(storage, project_id, recording_id)
        .await?
        .is_some_and(|(_, pieces)| pieces.iter().any(|piece| piece.blob_id == blob_id)))
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

async fn write_peaks(storage: &Arc<Storage>, recording_id: i64) -> Result<(), BoxedError> {
    let (recording, pieces) = read_state(storage, recording_id)
        .await?
        .ok_or(MISSING_RECORDING)?;
    let Some(audio) = recording.audio.as_ref() else {
        return Ok(());
    };
    let samples = compose(storage, &recording, audio.frame_count, &pieces).await?;
    let path = blob_path(&storage.blobs_path, &audio.wave_blob_id);
    let staged = path.with_extension("next");
    write_file(&staged, encode_peaks(&measure_peaks(&samples))).await?;
    rename(&staged, &path).await?;
    Ok(())
}

async fn refresh_peaks(storage: &Arc<Storage>, recording_id: i64) {
    let _ = write_peaks(storage, recording_id).await;
}

pub(crate) async fn ensure_recording(
    storage: &Arc<Storage>,
    area: &Path,
    recording_id: i64,
    format: TakeFormat,
) -> Result<RecordingAudio, BoxedError> {
    let existing = read_database(storage, move |database| database.recording(recording_id))
        .await?
        .ok_or(MISSING_RECORDING)?;
    if let Some(audio) = existing.audio {
        return Ok(audio);
    }
    let wave = stage_blob(area, &storage.blobs_path);
    wave.create().await?;
    write_file(wave.path(), vec![0_u8; PEAK_BYTE_LENGTH]).await?;
    let audio = RecordingAudio {
        wave_blob_id: wave.blob_id().to_owned(),
        sample_rate: format.sample_rate,
        frame_count: format.frame_count,
    };
    let stored = audio.clone();
    publish(storage, &[&wave], move |writer| {
        writer.set_recording_audio(recording_id, &stored)
    })
    .await?;
    Ok(audio)
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
    recording_id: i64,
    take: FinishedTake<'_>,
) -> Result<History, BoxedError> {
    let (recording, stored) = read_state(storage, recording_id)
        .await?
        .ok_or(MISSING_RECORDING)?;
    let sample_rate = recording
        .audio
        .as_ref()
        .ok_or(MISSING_RECORDING)?
        .sample_rate;
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
            write_planned(&blob, plan, &pcm, sample_rate).await?;
            let blob_id = blob.blob_id().to_owned();
            staged.push(blob);
            blob_id
        };
        next.push(RecordingPiece {
            blob_id,
            layer: RecordingLayer::Base,
            song_start_frame: plan.song_start_frame,
            frame_count: plan.frame_count,
            tempo: plan.tempo,
        });
    }
    next.push(take.piece);
    staged.push(take.blob);
    let committed: Vec<&StagedBlob> = staged.iter().collect();
    publish(storage, &committed, move |writer| {
        writer.replace_recording_pieces(recording_id, &next, true)
    })
    .await?;
    refresh_peaks(storage, recording_id).await;
    Ok(History {
        can_undo: true,
        can_redo: false,
    })
}

pub(crate) async fn set_fresh_applied(
    storage: &Arc<Storage>,
    project_id: i64,
    recording_id: i64,
    applied: bool,
) -> Result<Option<History>, BoxedError> {
    let Some((recording, pieces)) = read_project_state(storage, project_id, recording_id).await?
    else {
        return Ok(None);
    };
    if fresh_piece(&pieces).is_none() || recording.fresh_applied == applied {
        return Ok(None);
    }
    write_database(storage, move |writer| {
        writer.set_recording_fresh_applied(recording_id, applied)
    })
    .await?;
    refresh_peaks(storage, recording_id).await;
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
            tempo: 1.0,
        };
        let fresh = RecordingPiece {
            blob_id: "fresh".to_owned(),
            layer: RecordingLayer::Fresh,
            song_start_frame: 2,
            frame_count: 2,
            tempo: 1.0,
        };
        let mut pcm = PcmCache::new();
        pcm.insert("base".to_owned(), vec![1; 6]);
        pcm.insert("fresh".to_owned(), vec![9; 2]);

        assert_eq!(render(8, &[&base], &pcm), [1, 1, 1, 1, 1, 1, 0, 0]);
        assert_eq!(render(8, &[&base, &fresh], &pcm), [1, 1, 9, 9, 1, 1, 0, 0]);
    }

    #[test]
    fn places_a_slow_piece_on_the_song_timeline() {
        let slow = RecordingPiece {
            blob_id: "slow".to_owned(),
            layer: RecordingLayer::Base,
            song_start_frame: 1,
            frame_count: 4,
            tempo: 0.5,
        };
        let mut pcm = PcmCache::new();
        pcm.insert("slow".to_owned(), vec![1, 2, 3, 4]);

        assert_eq!(render(4, &[&slow], &pcm), [0, 1, 3, 0]);
    }

    #[test]
    fn measures_peaks_per_segment() {
        let peaks = measure_peaks(&[0, 16384, -16384, 0]);

        assert!((peaks[0] - 0.0).abs() < f32::EPSILON);
        assert!((peaks[3] - 0.5).abs() < f32::EPSILON);
    }
}
