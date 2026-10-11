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
        FinishedTake, History, TakeFormat, TakeRun, commit_take, ensure_recording, frames_per_peak,
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

struct Run {
    start_frame: i64,
    blob: StagedBlob,
    audio: File,
    frame_count: i64,
}

struct LivePeak {
    low: f32,
    high: f32,
    run: usize,
}

impl LivePeak {
    fn add(&mut self, value: f32, run: usize) {
        if self.run == run {
            self.low = self.low.min(value);
            self.high = self.high.max(value);
        } else {
            *self = Self {
                low: value,
                high: value,
                run,
            };
        }
    }
}

pub(crate) struct Session {
    recording_id: i64,
    song_frame_count: i64,
    sample_rate: i64,
    tempo: f64,
    area: PathBuf,
    blobs_path: PathBuf,
    runs: Vec<Run>,
    wave: File,
    live_peaks: BTreeMap<usize, LivePeak>,
}

impl Session {
    pub(crate) async fn create(
        storage: &Arc<Storage>,
        project_id: i64,
        recording_id: i64,
        format: TakeFormat,
    ) -> Result<Self, BoxedError> {
        let found =
            read_database(storage, move |database| database.project_name(project_id)).await?;
        if found.is_none() {
            return Err(format!("Project with id {project_id} not found").into());
        }
        let area = recording_area(&storage.work_path, project_id);
        open_area(&area).await?;
        let recording = ensure_recording(storage, &area, recording_id, format).await?;
        let wave =
            open_for_update(&blob_path(&storage.blobs_path, &recording.wave_blob_id)).await?;
        Ok(Self {
            recording_id,
            song_frame_count: recording.frame_count,
            sample_rate: recording.sample_rate,
            tempo: format.tempo,
            area,
            blobs_path: storage.blobs_path.clone(),
            runs: Vec::new(),
            wave,
            live_peaks: BTreeMap::new(),
        })
    }

    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_precision_loss,
        reason = "frame positions stay far below 2^53"
    )]
    fn recorded_limit(&self, start_frame: i64) -> i64 {
        ((self.song_frame_count - start_frame) as f64 / self.tempo).ceil() as i64
    }

    async fn open_run(&self, start_frame: i64) -> Result<Run, BoxedError> {
        let blob = stage_blob(&self.area, &self.blobs_path);
        let mut audio = blob.create().await?;
        audio
            .write_all(&create_header(0, u32::try_from(self.sample_rate)?))
            .await?;
        Ok(Run {
            start_frame,
            blob,
            audio,
            frame_count: 0,
        })
    }

    pub(crate) async fn write_chunk(
        &mut self,
        start_frame: u32,
        offset: u32,
        samples: &[f32],
    ) -> Result<usize, BoxedError> {
        let run_start = i64::from(start_frame);
        let run_offset = i64::from(offset);
        let available =
            usize::try_from((self.recorded_limit(run_start) - run_offset).max(0)).unwrap_or(0);
        let frame_length = samples.len().min(available);
        if frame_length == 0 {
            return Ok(0);
        }
        let continues = run_offset > 0
            && self
                .runs
                .last()
                .is_some_and(|run| run.start_frame == run_start);
        if !continues {
            let run = self.open_run(run_start).await?;
            self.runs.push(run);
        }
        let Some(run) = self.runs.last_mut() else {
            return Ok(0);
        };
        let mut chunk = Vec::with_capacity(frame_length * usize::from(BYTES_PER_SAMPLE));
        for sample in &samples[..frame_length] {
            chunk.extend_from_slice(&to_pcm(*sample).to_le_bytes());
        }
        run.audio
            .seek(SeekFrom::Start(frame_offset(run_offset)?))
            .await?;
        run.audio.write_all(&chunk).await?;
        run.frame_count = run
            .frame_count
            .max(run_offset + i64::try_from(frame_length)?);
        Ok(frame_length)
    }

    #[expect(
        clippy::cast_precision_loss,
        reason = "frame positions stay far below 2^53"
    )]
    pub(crate) async fn patch_peaks(
        &mut self,
        start_frame: u32,
        offset: u32,
        samples: &[f32],
    ) -> Result<Option<PeakPatch>, BoxedError> {
        if samples.is_empty() || self.song_frame_count == 0 {
            return Ok(None);
        }
        let run = self.runs.len();
        let step = frames_per_peak(self.song_frame_count);
        let mut touched: Option<(usize, usize)> = None;
        for (index, sample) in samples.iter().enumerate() {
            let recorded = (i64::from(offset) + i64::try_from(index)?) as f64;
            let song = f64::from(start_frame) + recorded * self.tempo;
            let peak = peak_index(song, step);
            if peak >= WAVE_PEAK_COUNT {
                break;
            }
            let value = sample_value(to_pcm(*sample));
            self.live_peaks
                .entry(peak)
                .and_modify(|live| live.add(value, run))
                .or_insert(LivePeak {
                    low: value,
                    high: value,
                    run,
                });
            touched = Some(touched.map_or((peak, peak), |(first, _)| (first, peak)));
        }
        let Some((first, last)) = touched else {
            return Ok(None);
        };
        let mut peaks = Vec::with_capacity((last - first + 1) * 2);
        for peak in first..=last {
            let (low, high) = self
                .live_peaks
                .get(&peak)
                .map_or((0.0, 0.0), |live| (live.low, live.high));
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
        let mut runs = Vec::with_capacity(self.runs.len());
        for mut run in self.runs {
            let header = create_header(
                u32::try_from(run.frame_count)?,
                u32::try_from(self.sample_rate)?,
            );
            run.audio.seek(SeekFrom::Start(0)).await?;
            run.audio.write_all(&header).await?;
            run.audio.flush().await?;
            drop(run.audio);
            runs.push(TakeRun {
                piece: RecordingPiece {
                    blob_id: run.blob.blob_id().to_owned(),
                    layer: RecordingLayer::Fresh,
                    song_start_frame: run.start_frame,
                    frame_count: run.frame_count,
                    tempo: self.tempo,
                },
                blob: run.blob,
            });
        }
        self.wave.flush().await?;
        drop(self.wave);
        let committed = if runs.is_empty() {
            Ok(None)
        } else {
            let take = FinishedTake {
                area: &self.area,
                runs,
            };
            commit_take(storage, self.recording_id, take)
                .await
                .map(Some)
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
