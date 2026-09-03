use std::path::Path;

use crate::{
    Tools,
    run::{BoxedError, run},
};

const SINGLE_CHANNEL: [&str; 2] = ["-ac", "1"];
const MEAN_OF_STEREO: [&str; 2] = ["-af", "pan=mono|c0=0.5*c0+0.5*c1"];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Downmix {
    Ffmpeg,
    Mean,
}

pub async fn decode_mono_pcm(
    tools: &Tools,
    from: &Path,
    sample_rate: u32,
    downmix: Downmix,
) -> Result<Vec<u8>, BoxedError> {
    let mut arguments = vec![
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
    ];
    arguments.extend(read_downmix(downmix).map(str::to_owned));
    arguments.extend([
        "-ar".to_owned(),
        sample_rate.to_string(),
        "-f".to_owned(),
        "f32le".to_owned(),
        "-c:a".to_owned(),
        "pcm_f32le".to_owned(),
        "pipe:1".to_owned(),
    ]);
    let finished = run(&tools.ffmpeg, &arguments).await?;
    if finished.is_empty() {
        return Err("ffmpeg produced no audio data".into());
    }
    Ok(finished)
}

fn read_downmix(downmix: Downmix) -> [&'static str; 2] {
    match downmix {
        Downmix::Ffmpeg => SINGLE_CHANNEL,
        Downmix::Mean => MEAN_OF_STEREO,
    }
}
