use std::path::Path;

use crate::{Tools, run::BoxedError, run::run};

#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "the frame count is a floored duration, the way Math.floor produces it"
)]
pub async fn read_frame_count(
    tools: &Tools,
    from: &Path,
    sample_rate: u32,
) -> Result<u64, BoxedError> {
    let arguments = vec![
        "-v".to_owned(),
        "error".to_owned(),
        "-select_streams".to_owned(),
        "a:0".to_owned(),
        "-show_entries".to_owned(),
        "format=duration".to_owned(),
        "-of".to_owned(),
        "default=nk=1:nw=1".to_owned(),
        from.display().to_string(),
    ];
    let finished = run(&tools.ffprobe, &arguments).await?;
    let reported = String::from_utf8_lossy(&finished.stdout);
    let seconds = reported
        .lines()
        .filter_map(|line| line.trim().parse::<f64>().ok())
        .find(|value| value.is_finite() && *value != 0.0)
        .ok_or("Invalid audio duration")?;
    let frames = (seconds * f64::from(sample_rate)).floor();
    Ok(frames.max(0.0) as u64)
}
