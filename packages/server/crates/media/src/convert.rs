use std::path::Path;

use tokio::fs::create_dir_all;

use crate::{Tools, run::BoxedError, run::run};

const FRAGMENT_DURATION_MICROS: u32 = 2_000_000;

pub async fn convert_to_flac(
    tools: &Tools,
    from: &Path,
    to: &Path,
    sample_rate: u32,
) -> Result<(), BoxedError> {
    create_parent(to).await?;
    let arguments = vec![
        "-y".to_owned(),
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
        "-acodec".to_owned(),
        "flac".to_owned(),
        "-f".to_owned(),
        "flac".to_owned(),
        "-ar".to_owned(),
        sample_rate.to_string(),
        to.display().to_string(),
    ];
    run(&tools.ffmpeg, &arguments).await?;
    Ok(())
}

pub async fn convert_to_fmp4(
    tools: &Tools,
    from: &Path,
    to: &Path,
    sample_rate: u32,
) -> Result<(), BoxedError> {
    create_parent(to).await?;
    let fragment_duration = FRAGMENT_DURATION_MICROS.to_string();
    let arguments = vec![
        "-y".to_owned(),
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
        "-ar".to_owned(),
        sample_rate.to_string(),
        "-c:a".to_owned(),
        "aac".to_owned(),
        "-profile:a".to_owned(),
        "aac_low".to_owned(),
        "-b:a".to_owned(),
        "256k".to_owned(),
        "-f".to_owned(),
        "mp4".to_owned(),
        "-movflags".to_owned(),
        "+frag_keyframe+empty_moov+default_base_moof".to_owned(),
        "-frag_duration".to_owned(),
        fragment_duration.clone(),
        "-min_frag_duration".to_owned(),
        fragment_duration,
        to.display().to_string(),
    ];
    run(&tools.ffmpeg, &arguments).await?;
    Ok(())
}

async fn create_parent(to: &Path) -> Result<(), BoxedError> {
    if let Some(directory) = to.parent() {
        create_dir_all(directory).await?;
    }
    Ok(())
}
