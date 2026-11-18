use std::path::Path;

use musetric_dsp::flac::{FlacInfo, INFO_BYTE_LENGTH, read_info};
use tokio::{fs::File, io::AsyncReadExt};

use crate::BoxedError;

const NO_FRAMES: &str = "The audio master holds no frames";

pub async fn read_frame_count(from: &Path) -> Result<u64, BoxedError> {
    let counted = read_flac_info(from).await?.frame_count;
    if counted == 0 {
        return Err(NO_FRAMES.into());
    }
    Ok(counted)
}

pub async fn read_flac_sample_rate(from: &Path) -> Result<u32, BoxedError> {
    Ok(read_flac_info(from).await?.sample_rate)
}

pub(crate) async fn read_flac_info(from: &Path) -> Result<FlacInfo, BoxedError> {
    let mut header = [0_u8; INFO_BYTE_LENGTH];
    File::open(from).await?.read_exact(&mut header).await?;
    read_info(&header)
}
