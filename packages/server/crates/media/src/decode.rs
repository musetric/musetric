use std::{
    ffi::OsStr,
    fs::File,
    path::{Path, PathBuf},
};

use musetric_dsp::decode::{DecodeRequest, Layout, decode as decode_source};
use tokio::{sync::mpsc, task::spawn_blocking};

use crate::{
    BoxedError,
    pcm::{PcmRequest, PcmSink, PcmSource, ReadingPcm},
};

const QUEUE_DEPTH: usize = 8;

pub struct SymphoniaPcm;

impl PcmSource for SymphoniaPcm {
    fn read_pcm<'source>(
        &'source self,
        request: PcmRequest<'source>,
        sink: PcmSink<'source>,
    ) -> ReadingPcm<'source> {
        Box::pin(read(request.from.to_owned(), request.sample_rate, sink))
    }
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
