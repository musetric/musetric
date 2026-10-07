use std::{
    collections::BTreeMap,
    io::SeekFrom,
    path::{Path, PathBuf},
    sync::Arc,
};

use musetric_db::{BoxedError, RecordingLayer, RecordingPiece, blob_path};
use musetric_media::WAVE_PEAK_COUNT;
use tokio::{
    fs::{File, OpenOptions},
    io::{AsyncSeekExt, AsyncWriteExt},
};

use crate::{
    blobs::{StagedBlob, close_area, open_area, recording_area, stage_blob},
    recording::{
        FinishedTake, History, TakeFormat, commit_take, ensure_recording, frames_per_peak,
        peak_index, sample_value,
    },
    storage::{Storage, read_database},
    wav::{BYTES_PER_SAMPLE, HEADER_BYTE_LENGTH, create_header},
};

const FULL_SCALE: f64 = 32768.0;
const POSITIVE_SCALE: f64 = 32767.0;

pub(crate) struct PeakPatch {
    pub(crate) start_peak_index: usize,
    pub(crate) peaks: Vec<f32>,
}

pub(crate) struct Session {
    project_id: i64,
    song_frame_count: i64,
    sample_rate: i64,
    area: PathBuf,
    take: StagedBlob,
    audio: File,
    wave: File,
    anchor: Option<i64>,
    recorded_frame_count: i64,
    live_peaks: BTreeMap<usize, (f32, f32)>,
}

impl Session {
    pub(crate) async fn create(
        storage: &Arc<Storage>,
        project_id: i64,
        format: TakeFormat,
    ) -> Result<Self, BoxedError> {
        let found =
            read_database(storage, move |database| database.project_name(project_id)).await?;
        if found.is_none() {
            return Err(format!("Project with id {project_id} not found").into());
        }
        let area = recording_area(&storage.work_path, project_id);
        open_area(&area).await?;
        let recording = ensure_recording(storage, &area, project_id, format).await?;
        let take = stage_blob(&area, &storage.blobs_path);
        let mut audio = take.create().await?;
        audio
            .write_all(&create_header(0, u32::try_from(recording.sample_rate)?))
            .await?;
        let wave =
            open_for_update(&blob_path(&storage.blobs_path, &recording.wave_blob_id)).await?;
        Ok(Self {
            project_id,
            song_frame_count: recording.frame_count,
            sample_rate: recording.sample_rate,
            area,
            take,
            audio,
            wave,
            anchor: None,
            recorded_frame_count: 0,
            live_peaks: BTreeMap::new(),
        })
    }

    fn recorded_limit(&self, anchor: i64) -> i64 {
        self.song_frame_count - anchor
    }

    pub(crate) async fn write_chunk(
        &mut self,
        frame_index: u32,
        samples: &[f32],
    ) -> Result<usize, BoxedError> {
        if self.anchor.is_none() && i64::from(frame_index) >= self.song_frame_count {
            return Ok(0);
        }
        let anchor = *self.anchor.get_or_insert(i64::from(frame_index));
        let offset = i64::from(frame_index) - anchor;
        if offset < 0 {
            return Ok(0);
        }
        let available = usize::try_from((self.recorded_limit(anchor) - offset).max(0)).unwrap_or(0);
        let frame_length = samples.len().min(available);
        if frame_length == 0 {
            return Ok(0);
        }
        let mut chunk = Vec::with_capacity(frame_length * usize::from(BYTES_PER_SAMPLE));
        for sample in &samples[..frame_length] {
            chunk.extend_from_slice(&to_pcm(*sample).to_le_bytes());
        }
        self.audio
            .seek(SeekFrom::Start(frame_offset(offset)?))
            .await?;
        self.audio.write_all(&chunk).await?;
        self.recorded_frame_count = self
            .recorded_frame_count
            .max(offset + i64::try_from(frame_length)?);
        Ok(frame_length)
    }

    #[expect(
        clippy::cast_precision_loss,
        reason = "frame positions stay far below 2^53"
    )]
    pub(crate) async fn patch_peaks(
        &mut self,
        frame_index: u32,
        samples: &[f32],
    ) -> Result<Option<PeakPatch>, BoxedError> {
        let Some(anchor) = self.anchor else {
            return Ok(None);
        };
        if samples.is_empty() || self.song_frame_count == 0 {
            return Ok(None);
        }
        let step = frames_per_peak(self.song_frame_count);
        let offset = i64::from(frame_index) - anchor;
        let mut touched: Option<(usize, usize)> = None;
        for (index, sample) in samples.iter().enumerate() {
            let recorded = (offset + i64::try_from(index)?) as f64;
            let song = anchor as f64 + recorded;
            let peak = peak_index(song, step);
            if peak >= WAVE_PEAK_COUNT {
                break;
            }
            let value = sample_value(to_pcm(*sample));
            self.live_peaks
                .entry(peak)
                .and_modify(|(low, high)| {
                    *low = low.min(value);
                    *high = high.max(value);
                })
                .or_insert((value, value));
            touched = Some(touched.map_or((peak, peak), |(first, _)| (first, peak)));
        }
        let Some((first, last)) = touched else {
            return Ok(None);
        };
        let mut peaks = Vec::with_capacity((last - first + 1) * 2);
        for peak in first..=last {
            let (low, high) = self.live_peaks.get(&peak).copied().unwrap_or_default();
            peaks.push(low);
            peaks.push(high);
        }
        self.write_peaks(first, &peaks).await?;
        Ok(Some(PeakPatch {
            start_peak_index: first,
            peaks,
        }))
    }

    async fn write_peaks(
        &mut self,
        start_peak_index: usize,
        peaks: &[f32],
    ) -> Result<(), BoxedError> {
        let mut bytes = Vec::with_capacity(peaks.len() * 4);
        for peak in peaks {
            bytes.extend_from_slice(&peak.to_le_bytes());
        }
        let offset = u64::try_from(start_peak_index * 2 * 4)?;
        self.wave.seek(SeekFrom::Start(offset)).await?;
        self.wave.write_all(&bytes).await?;
        Ok(())
    }

    pub(crate) async fn finish(
        mut self,
        storage: &Arc<Storage>,
    ) -> Result<Option<History>, BoxedError> {
        let header = create_header(
            u32::try_from(self.recorded_frame_count)?,
            u32::try_from(self.sample_rate)?,
        );
        self.audio.seek(SeekFrom::Start(0)).await?;
        self.audio.write_all(&header).await?;
        self.audio.flush().await?;
        self.wave.flush().await?;
        drop(self.audio);
        drop(self.wave);
        let committed = match self.anchor {
            Some(anchor) if self.recorded_frame_count > 0 => {
                let piece = RecordingPiece {
                    blob_id: self.take.blob_id().to_owned(),
                    layer: RecordingLayer::Fresh,
                    song_start_frame: anchor,
                    frame_count: self.recorded_frame_count,
                };
                let take = FinishedTake {
                    area: &self.area,
                    blob: self.take,
                    piece,
                };
                commit_take(storage, self.project_id, take).await.map(Some)
            }
            _ => {
                self.take.discard().await;
                Ok(None)
            }
        };
        close_area(&self.area).await;
        committed
    }
}

async fn open_for_update(path: &Path) -> Result<File, BoxedError> {
    Ok(OpenOptions::new().read(true).write(true).open(path).await?)
}

fn frame_offset(frame_index: i64) -> Result<u64, BoxedError> {
    let header_length = i64::try_from(HEADER_BYTE_LENGTH)?;
    let audio_length = frame_index
        .checked_mul(i64::from(BYTES_PER_SAMPLE))
        .ok_or("The recording is too large.")?;
    let offset = header_length
        .checked_add(audio_length)
        .ok_or("The recording is too large.")?;
    Ok(u64::try_from(offset)?)
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "the TypeScript recorder truncates a clamped sample before writing Int16LE"
)]
fn to_pcm(sample: f32) -> i16 {
    let clamped = f64::from(sample).clamp(-1.0, 1.0);
    let scaled = if clamped < 0.0 {
        clamped * FULL_SCALE
    } else {
        clamped * POSITIVE_SCALE
    };
    scaled as i16
}
