use std::{
    io::SeekFrom,
    path::{Path, PathBuf},
    sync::Arc,
};

use musetric_db::{BoxedError, NewRecording, Recording, blob_path};
use musetric_media::{WAVE_PEAK_COUNT, generate_wave_peaks};
use tokio::{
    fs::{File, OpenOptions, create_dir_all, try_exists, write as write_file},
    io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt},
};

use crate::{
    blobs::{create_blob_ref, discard_blob},
    storage::{Storage, read_database, write_database},
    wav::{BYTES_PER_SAMPLE, HEADER_BYTE_LENGTH, create_header},
};

const PEAK_BYTE_LENGTH: usize = WAVE_PEAK_COUNT * 2 * 4;
const FULL_SCALE: f64 = 32768.0;
const POSITIVE_SCALE: f64 = 32767.0;

pub(crate) struct PeakPatch {
    pub(crate) start_peak_index: usize,
    pub(crate) peaks: Vec<f32>,
}

pub(crate) struct Session {
    frame_count: i64,
    sample_rate: i64,
    audio_path: PathBuf,
    wave_path: PathBuf,
    audio: File,
    wave: File,
}

struct ReservedBlobs {
    audio_path: PathBuf,
    wave_path: PathBuf,
    sample_rate: i64,
    frame_count: i64,
}

impl Session {
    pub(crate) async fn create(
        storage: &Arc<Storage>,
        project_id: i64,
        sample_rate: i64,
        frame_count: i64,
    ) -> Result<Self, BoxedError> {
        let found =
            read_database(storage, move |database| database.project_name(project_id)).await?;
        if found.is_none() {
            return Err(format!("Project with id {project_id} not found").into());
        }
        let existing =
            read_database(storage, move |database| database.recording(project_id)).await?;
        let blobs = match existing {
            Some(recording) => reuse_blobs(storage, &recording).await?,
            None => reserve_blobs(storage, project_id, sample_rate, frame_count).await?,
        };
        Ok(Self {
            frame_count: blobs.frame_count,
            sample_rate: blobs.sample_rate,
            audio: open_for_update(&blobs.audio_path).await?,
            wave: open_for_update(&blobs.wave_path).await?,
            audio_path: blobs.audio_path,
            wave_path: blobs.wave_path,
        })
    }

    pub(crate) async fn write_chunk(
        &mut self,
        frame_index: u32,
        samples: &[f32],
    ) -> Result<usize, BoxedError> {
        let start = i64::from(frame_index);
        if start >= self.frame_count {
            return Ok(0);
        }
        let available = usize::try_from(self.frame_count - start).unwrap_or(usize::MAX);
        let frame_length = samples.len().min(available);
        if frame_length == 0 {
            return Ok(0);
        }
        let mut chunk = Vec::with_capacity(frame_length * BYTES_PER_SAMPLE as usize);
        for sample in &samples[..frame_length] {
            chunk.extend_from_slice(&to_pcm(*sample).to_le_bytes());
        }
        self.audio
            .seek(SeekFrom::Start(frame_offset(start)?))
            .await?;
        self.audio.write_all(&chunk).await?;
        Ok(frame_length)
    }

    pub(crate) async fn patch_peaks(
        &mut self,
        frame_index: u32,
        frame_length: usize,
    ) -> Result<Option<PeakPatch>, BoxedError> {
        if frame_length == 0 || self.frame_count == 0 {
            return Ok(None);
        }
        let frames_per_peak = frames_per_peak(self.frame_count);
        let start = i64::from(frame_index);
        let written_frame_length = i64::try_from(frame_length)?;
        let last = start + written_frame_length - 1;
        let start_peak_index = peak_index(start, frames_per_peak);
        let end_peak_index = peak_index(last, frames_per_peak).min(WAVE_PEAK_COUNT - 1);
        if end_peak_index < start_peak_index {
            return Ok(None);
        }
        let mut peaks = Vec::with_capacity((end_peak_index - start_peak_index + 1) * 2);
        for index in start_peak_index..=end_peak_index {
            let (low, high) = self.measure_peak(index, frames_per_peak).await?;
            peaks.push(low);
            peaks.push(high);
        }
        self.write_peaks(start_peak_index, &peaks).await?;
        Ok(Some(PeakPatch {
            start_peak_index,
            peaks,
        }))
    }

    pub(crate) async fn finish(mut self, storage: &Arc<Storage>) -> Result<(), BoxedError> {
        self.audio.flush().await?;
        self.wave.flush().await?;
        drop(self.audio);
        drop(self.wave);
        let sample_rate = u32::try_from(self.sample_rate)?;
        generate_wave_peaks(
            &storage.tools,
            &self.audio_path,
            &self.wave_path,
            sample_rate,
        )
        .await
    }

    async fn measure_peak(
        &mut self,
        peak_index: usize,
        frames_per_peak: f64,
    ) -> Result<(f32, f32), BoxedError> {
        let start_frame = peak_frame(peak_index, frames_per_peak);
        let end_frame = peak_frame(peak_index + 1, frames_per_peak).min(self.frame_count);
        let count = usize::try_from((end_frame - start_frame).max(0)).unwrap_or(0);
        let mut buffer = vec![0_u8; count * BYTES_PER_SAMPLE as usize];
        self.audio
            .seek(SeekFrom::Start(frame_offset(start_frame)?))
            .await?;
        read_available(&mut self.audio, &mut buffer).await?;
        let mut low = 0.0_f64;
        let mut high = 0.0_f64;
        for frame in buffer.chunks_exact(BYTES_PER_SAMPLE as usize) {
            let value = f64::from(i16::from_le_bytes([frame[0], frame[1]])) / FULL_SCALE;
            low = low.min(value);
            high = high.max(value);
        }
        #[expect(
            clippy::cast_possible_truncation,
            reason = "the TypeScript recorder stores live peaks in a Float32Array"
        )]
        Ok((low as f32, high as f32))
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
        let offset = (start_peak_index * 2 * 4) as u64;
        self.wave.seek(SeekFrom::Start(offset)).await?;
        self.wave.write_all(&bytes).await?;
        Ok(())
    }
}

async fn reserve_blobs(
    storage: &Arc<Storage>,
    project_id: i64,
    sample_rate: i64,
    frame_count: i64,
) -> Result<ReservedBlobs, BoxedError> {
    let audio = create_blob_ref(&storage.blobs_path);
    let wave = create_blob_ref(&storage.blobs_path);
    if let Err(error) = create_reserved_wav(&audio.path, sample_rate, frame_count).await {
        discard_reserved_blobs(storage, &audio.blob_id, &wave.blob_id).await;
        return Err(error);
    }
    if let Err(error) = write_empty_peaks(&wave.path).await {
        discard_reserved_blobs(storage, &audio.blob_id, &wave.blob_id).await;
        return Err(error);
    }
    let recording = NewRecording {
        project_id,
        blob_id: audio.blob_id.clone(),
        wave_blob_id: wave.blob_id.clone(),
        sample_rate,
        frame_count,
    };
    if let Err(error) =
        write_database(storage, move |writer| writer.create_recording(&recording)).await
    {
        discard_reserved_blobs(storage, &audio.blob_id, &wave.blob_id).await;
        return Err(error);
    }
    Ok(ReservedBlobs {
        audio_path: audio.path,
        wave_path: wave.path,
        sample_rate,
        frame_count,
    })
}

async fn discard_reserved_blobs(storage: &Arc<Storage>, audio_blob_id: &str, wave_blob_id: &str) {
    discard_blob(&storage.blobs_path, audio_blob_id).await;
    discard_blob(&storage.blobs_path, wave_blob_id).await;
}

async fn reuse_blobs(
    storage: &Arc<Storage>,
    recording: &Recording,
) -> Result<ReservedBlobs, BoxedError> {
    let audio_path = blob_path(&storage.blobs_path, &recording.blob_id);
    let wave_path = blob_path(&storage.blobs_path, &recording.wave_blob_id);
    if !try_exists(&audio_path).await.unwrap_or(false) {
        create_reserved_wav(&audio_path, recording.sample_rate, recording.frame_count).await?;
    }
    if !try_exists(&wave_path).await.unwrap_or(false) {
        write_empty_peaks(&wave_path).await?;
    }
    Ok(ReservedBlobs {
        audio_path,
        wave_path,
        sample_rate: recording.sample_rate,
        frame_count: recording.frame_count,
    })
}

async fn create_reserved_wav(
    path: &Path,
    sample_rate: i64,
    frame_count: i64,
) -> Result<(), BoxedError> {
    create_parent(path).await?;
    let header = create_header(u32::try_from(frame_count)?, u32::try_from(sample_rate)?);
    let file = File::create(path).await?;
    file.set_len(frame_offset(frame_count)?).await?;
    let mut file = file;
    file.write_all(&header).await?;
    file.flush().await?;
    Ok(())
}

async fn write_empty_peaks(path: &Path) -> Result<(), BoxedError> {
    create_parent(path).await?;
    write_file(path, vec![0_u8; PEAK_BYTE_LENGTH]).await?;
    Ok(())
}

async fn create_parent(path: &Path) -> Result<(), BoxedError> {
    if let Some(directory) = path.parent() {
        create_dir_all(directory).await?;
    }
    Ok(())
}

async fn open_for_update(path: &Path) -> Result<File, BoxedError> {
    Ok(OpenOptions::new().read(true).write(true).open(path).await?)
}

async fn read_available(file: &mut File, buffer: &mut [u8]) -> Result<(), BoxedError> {
    let mut filled = 0;
    while filled < buffer.len() {
        let read = file.read(&mut buffer[filled..]).await?;
        if read == 0 {
            return Ok(());
        }
        filled += read;
    }
    Ok(())
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
    clippy::cast_precision_loss,
    reason = "the peak segment calculation is the TypeScript recorder's floating-point protocol"
)]
fn frames_per_peak(frame_count: i64) -> f64 {
    (frame_count as f64 / WAVE_PEAK_COUNT as f64).max(1.0)
}

#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    reason = "the peak index is floored with JavaScript number semantics"
)]
fn peak_index(frame_index: i64, frames_per_peak: f64) -> usize {
    let index = (frame_index as f64 / frames_per_peak).floor().max(0.0);
    index as usize
}

#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    reason = "the peak boundary is floored with JavaScript number semantics"
)]
fn peak_frame(peak_index: usize, frames_per_peak: f64) -> i64 {
    (peak_index as f64 * frames_per_peak).floor() as i64
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
