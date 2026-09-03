use std::{path::Path, process::Stdio};

use tokio::{io::AsyncReadExt, process::Command};

use crate::{
    Tools,
    run::{BoxedError, run},
};

const BYTES_PER_FRAME: usize = 8;
const READ_BUFFER_BYTE_LENGTH: usize = 64 * 1024;

pub(crate) fn decode_arguments(from: &Path, sample_rate: u32) -> Vec<String> {
    vec![
        "-hide_banner".to_owned(),
        "-loglevel".to_owned(),
        "error".to_owned(),
        "-i".to_owned(),
        from.display().to_string(),
        "-map".to_owned(),
        "0:a:0".to_owned(),
        "-sn".to_owned(),
        "-dn".to_owned(),
        "-vn".to_owned(),
        "-ac".to_owned(),
        "2".to_owned(),
        "-ar".to_owned(),
        sample_rate.to_string(),
        "-f".to_owned(),
        "f32le".to_owned(),
        "-".to_owned(),
    ]
}

pub(crate) async fn read_pcm(
    tools: &Tools,
    from: &Path,
    sample_rate: u32,
    mut on_frame: impl FnMut(f32, f32, u64),
) -> Result<(), BoxedError> {
    let mut child = Command::new(&tools.ffmpeg)
        .args(decode_arguments(from, sample_rate))
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

    let mut carry = Vec::new();
    let mut buffer = vec![0_u8; READ_BUFFER_BYTE_LENGTH];
    let mut frame_index = 0_u64;
    loop {
        let read = stdout.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        carry.extend_from_slice(&buffer[..read]);
        let aligned = carry.len() - carry.len() % BYTES_PER_FRAME;
        for frame in carry[..aligned].chunks_exact(BYTES_PER_FRAME) {
            on_frame(read_float(frame, 0), read_float(frame, 1), frame_index);
            frame_index += 1;
        }
        carry.drain(..aligned);
    }

    let status = child.wait().await?;
    let reported = collect_stderr.await.unwrap_or_default();
    if !status.success() {
        let trimmed = reported.trim();
        let message = if trimmed.is_empty() {
            "ffmpeg failed to decode the audio".to_owned()
        } else {
            trimmed.to_owned()
        };
        return Err(message.into());
    }
    Ok(())
}

fn read_float(frame: &[u8], index: usize) -> f32 {
    let start = index * size_of::<f32>();
    let end = start + size_of::<f32>();
    frame
        .get(start..end)
        .and_then(|bytes| <[u8; 4]>::try_from(bytes).ok())
        .map_or(0.0, f32::from_le_bytes)
}

pub async fn decode_interleaved_pcm(
    tools: &Tools,
    from: &Path,
    sample_rate: u32,
) -> Result<Vec<u8>, BoxedError> {
    let finished = run(&tools.ffmpeg, &decode_arguments(from, sample_rate)).await?;
    if finished.is_empty() {
        return Err("ffmpeg produced no audio data".into());
    }
    Ok(finished)
}
