use std::{
    ffi::OsStr,
    fs::File,
    path::{Path, PathBuf},
    sync::mpsc::{SyncSender, sync_channel},
    thread,
};

use musetric_dsp::decode::{DecodeRequest, Layout, decode as decode_source};
use tokio::{sync::mpsc, task::spawn_blocking};

use crate::{
    BoxedError,
    pcm::{PcmChunks, PcmRequest, PcmSink, PcmSource, ReadingPcm},
};

const QUEUE_DEPTH: usize = 8;
const NOT_READ: &str = "Nobody reads the stream of the decoded audio";

pub struct SymphoniaPcm;

impl PcmSource for SymphoniaPcm {
    fn read_pcm<'source>(
        &'source self,
        request: PcmRequest<'source>,
        sink: PcmSink<'source>,
    ) -> ReadingPcm<'source> {
        Box::pin(read(request.from.to_owned(), request.sample_rate, sink))
    }

    fn stream_pcm(&self, request: PcmRequest<'_>) -> Result<PcmChunks, BoxedError> {
        let (produced, chunks) = sync_channel(QUEUE_DEPTH);
        let from = request.from.to_owned();
        let sample_rate = request.sample_rate;
        thread::Builder::new().spawn(move || {
            if let Err(failure) = stream(&from, sample_rate, &produced) {
                produced.send(Err(failure)).ok();
            }
        })?;
        Ok(chunks)
    }
}

type Produced = SyncSender<Result<Vec<f32>, BoxedError>>;

fn stream(from: &Path, sample_rate: u32, produced: &Produced) -> Result<(), BoxedError> {
    let request = DecodeRequest {
        source: Box::new(File::open(from)?),
        extension: from.extension().and_then(OsStr::to_str),
        sample_rate: Some(sample_rate),
        layout: Layout::Stereo,
    };
    decode_source(request, &mut |frames| {
        if frames.is_empty() {
            return Ok(());
        }
        produced
            .send(Ok(frames.to_vec()))
            .map_err(|_| NOT_READ.into())
    })?;
    Ok(())
}

async fn read(from: PathBuf, sample_rate: u32, sink: PcmSink<'_>) -> Result<(), BoxedError> {
    let (produced, mut ready) = mpsc::channel(QUEUE_DEPTH);
    let decoding = spawn_blocking(move || decode(&from, sample_rate, &produced));
    while let Some(chunk) = ready.recv().await {
        sink(&chunk);
    }
    decoding.await?
}

fn decode(
    from: &Path,
    sample_rate: u32,
    produced: &mpsc::Sender<Vec<f32>>,
) -> Result<(), BoxedError> {
    let request = DecodeRequest {
        source: Box::new(File::open(from)?),
        extension: from.extension().and_then(OsStr::to_str),
        sample_rate: Some(sample_rate),
        layout: Layout::Stereo,
    };
    decode_source(request, &mut |frames| send(produced, frames))?;
    Ok(())
}

fn send(produced: &mpsc::Sender<Vec<f32>>, frames: &[f32]) -> Result<(), BoxedError> {
    if frames.is_empty() {
        return Ok(());
    }
    produced.blocking_send(frames.to_vec())?;
    Ok(())
}
