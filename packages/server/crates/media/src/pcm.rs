use std::{
    future::Future,
    path::{Path, PathBuf},
    pin::Pin,
    process::Stdio,
};

use tokio::{io::AsyncReadExt, process::Command};

use crate::run::BoxedError;

pub(crate) const CHANNELS: usize = 2;
pub(crate) const BYTES_PER_FRAME: usize = CHANNELS * size_of::<f32>();
pub(crate) const READ_BUFFER_BYTE_LENGTH: usize = 64 * 1024;
const NO_AUDIO: &str = "The decoder produced no audio data";
const DECODE_FAILED: &str = "ffmpeg failed to decode the audio";

#[derive(Clone, Copy)]
pub struct PcmRequest<'request> {
    pub from: &'request Path,
    pub sample_rate: u32,
}

pub type ReadingPcm<'reading> =
    Pin<Box<dyn Future<Output = Result<(), BoxedError>> + Send + 'reading>>;

pub type PcmSink<'sink> = &'sink mut (dyn FnMut(&[f32]) + Send);

pub trait PcmSource: Send + Sync {
    fn read_pcm<'source>(
        &'source self,
        request: PcmRequest<'source>,
        sink: PcmSink<'source>,
    ) -> ReadingPcm<'source>;
}

pub struct FfmpegPcm {
    ffmpeg: PathBuf,
}

impl FfmpegPcm {
    #[must_use]
    pub fn create(ffmpeg: PathBuf) -> Self {
        Self { ffmpeg }
    }
}

impl PcmSource for FfmpegPcm {
    fn read_pcm<'source>(
        &'source self,
        request: PcmRequest<'source>,
        sink: PcmSink<'source>,
    ) -> ReadingPcm<'source> {
        Box::pin(decode_with_ffmpeg(&self.ffmpeg, request, sink))
    }
}

#[derive(Default)]
pub(crate) struct Frames {
    carry: Vec<u8>,
    samples: Vec<f32>,
}

impl Frames {
    pub(crate) fn push(&mut self, bytes: &[u8]) -> &[f32] {
        self.samples.clear();
        self.carry.extend_from_slice(bytes);
        let aligned = self.carry.len() - self.carry.len() % BYTES_PER_FRAME;
        for value in self.carry[..aligned].chunks_exact(size_of::<f32>()) {
            self.samples.push(read_float(value));
        }
        self.carry.drain(..aligned);
        &self.samples
    }
}

fn decode_arguments(request: PcmRequest<'_>) -> Vec<String> {
    vec![
        "-hide_banner".to_owned(),
        "-loglevel".to_owned(),
        "error".to_owned(),
        "-i".to_owned(),
        request.from.display().to_string(),
        "-map".to_owned(),
        "0:a:0".to_owned(),
        "-sn".to_owned(),
        "-dn".to_owned(),
        "-vn".to_owned(),
        "-ac".to_owned(),
        CHANNELS.to_string(),
        "-ar".to_owned(),
        request.sample_rate.to_string(),
        "-f".to_owned(),
        "f32le".to_owned(),
        "-".to_owned(),
    ]
}

async fn decode_with_ffmpeg(
    ffmpeg: &Path,
    request: PcmRequest<'_>,
    sink: PcmSink<'_>,
) -> Result<(), BoxedError> {
    let mut child = Command::new(ffmpeg)
        .args(decode_arguments(request))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or("ffmpeg was started without stdout")?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or("ffmpeg was started without stderr")?;
    let collect_stderr = tokio::spawn(async move {
        let mut reported = String::new();
        let _ = stderr.read_to_string(&mut reported).await;
        reported
    });

    let mut frames = Frames::default();
    let mut buffer = vec![0_u8; READ_BUFFER_BYTE_LENGTH];
    loop {
        let read = stdout.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        sink(frames.push(&buffer[..read]));
    }

    let status = child.wait().await?;
    let reported = collect_stderr.await.unwrap_or_default();
    if !status.success() {
        let trimmed = reported.trim();
        let message = if trimmed.is_empty() {
            DECODE_FAILED.to_owned()
        } else {
            trimmed.to_owned()
        };
        return Err(message.into());
    }
    Ok(())
}

fn read_float(bytes: &[u8]) -> f32 {
    <[u8; 4]>::try_from(bytes).map_or(0.0, f32::from_le_bytes)
}

pub async fn collect_interleaved_pcm(
    source: &dyn PcmSource,
    request: PcmRequest<'_>,
) -> Result<Vec<u8>, BoxedError> {
    let mut collected = Vec::new();
    read_into(source, request, &mut collected).await?;
    if collected.is_empty() {
        return Err(NO_AUDIO.into());
    }
    Ok(collected)
}

async fn read_into(
    source: &dyn PcmSource,
    request: PcmRequest<'_>,
    collected: &mut Vec<u8>,
) -> Result<(), BoxedError> {
    let mut sink = |chunk: &[f32]| {
        for sample in chunk {
            collected.extend_from_slice(&sample.to_le_bytes());
        }
    };
    source.read_pcm(request, &mut sink).await
}
