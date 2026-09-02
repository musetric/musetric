use std::path::Path;

use crate::{
    Tools,
    run::{BoxedError, run},
};

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
    arguments.extend(read_downmix(tools, from, downmix).await?);
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
    if finished.stdout.is_empty() {
        return Err("ffmpeg produced no audio data".into());
    }
    Ok(finished.stdout)
}

async fn read_downmix(
    tools: &Tools,
    from: &Path,
    downmix: Downmix,
) -> Result<Vec<String>, BoxedError> {
    if downmix == Downmix::Ffmpeg {
        return Ok(single_channel());
    }
    let channels = read_channel_count(tools, from).await?;
    Ok(mean_downmix(channels))
}

async fn read_channel_count(tools: &Tools, from: &Path) -> Result<u32, BoxedError> {
    let arguments = vec![
        "-v".to_owned(),
        "error".to_owned(),
        "-select_streams".to_owned(),
        "a:0".to_owned(),
        "-show_entries".to_owned(),
        "stream=channels".to_owned(),
        "-of".to_owned(),
        "csv=p=0".to_owned(),
        from.display().to_string(),
    ];
    let finished = run(&tools.ffprobe, &arguments).await?;
    let reported = String::from_utf8_lossy(&finished.stdout);
    reported
        .lines()
        .filter_map(|line| line.trim().parse::<u32>().ok())
        .find(|channels| *channels > 0)
        .ok_or_else(|| "Invalid audio channel count".into())
}

fn single_channel() -> Vec<String> {
    vec!["-ac".to_owned(), "1".to_owned()]
}

fn mean_downmix(channels: u32) -> Vec<String> {
    if channels <= 1 {
        return single_channel();
    }
    let weight = 1.0 / f64::from(channels);
    let terms = (0..channels)
        .map(|channel| format!("{weight}*c{channel}"))
        .collect::<Vec<_>>()
        .join("+");
    vec!["-af".to_owned(), format!("pan=mono|c0={terms}")]
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use super::{Downmix, mean_downmix, read_downmix};
    use crate::Tools;

    #[tokio::test]
    async fn keeps_the_ffmpeg_downmix_without_probing_the_source() {
        let tools = Tools {
            ffmpeg: PathBuf::from("missing-ffmpeg"),
            ffprobe: PathBuf::from("missing-ffprobe"),
        };

        let arguments = read_downmix(&tools, Path::new("missing.wav"), Downmix::Ffmpeg)
            .await
            .expect("the ffmpeg downmix should not need the source");

        assert_eq!(arguments, vec!["-ac", "1"]);
    }

    #[test]
    fn weights_every_channel_the_way_the_node_decoder_does() {
        assert_eq!(mean_downmix(1), vec!["-ac", "1"]);
        assert_eq!(mean_downmix(2), vec!["-af", "pan=mono|c0=0.5*c0+0.5*c1"]);
        assert_eq!(
            mean_downmix(3),
            vec![
                "-af",
                "pan=mono|c0=0.3333333333333333*c0+0.3333333333333333*c1+0.3333333333333333*c2"
            ]
        );
    }
}
