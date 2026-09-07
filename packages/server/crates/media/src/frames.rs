use std::path::Path;

use tokio::{fs::File, io::AsyncReadExt};

use crate::BoxedError;

const HEADER_BYTE_LENGTH: usize = 42;
const MAGIC: &[u8] = b"fLaC";
const STREAM_INFO_BLOCK: u8 = 0;
const BLOCK_TYPE_MASK: u8 = 0x7f;
const COUNTED_OFFSET: usize = 18;
const COUNTED_BITS: u64 = (1 << 36) - 1;
const SAMPLE_RATE_SHIFT: u32 = 44;
const CHANNELS_SHIFT: u32 = 41;
const CHANNELS_MASK: u64 = 0b111;
const NOT_FLAC: &str = "The audio master is not a flac stream";
const NO_FRAMES: &str = "The audio master holds no frames";

pub(crate) struct FlacInfo {
    pub(crate) sample_rate: u32,
    pub(crate) channels: u32,
}

pub async fn read_frame_count(from: &Path) -> Result<u64, BoxedError> {
    let counted = read_counted(&read_header(from).await?)?;
    if counted == 0 {
        return Err(NO_FRAMES.into());
    }
    Ok(counted)
}

pub async fn read_flac_sample_rate(from: &Path) -> Result<u32, BoxedError> {
    Ok(read_flac_info(from).await?.sample_rate)
}

pub(crate) async fn read_flac_info(from: &Path) -> Result<FlacInfo, BoxedError> {
    let packed = read_packed(&read_header(from).await?)?;
    let channels = u32::try_from((packed >> CHANNELS_SHIFT) & CHANNELS_MASK)? + 1;
    Ok(FlacInfo {
        sample_rate: u32::try_from(packed >> SAMPLE_RATE_SHIFT)?,
        channels,
    })
}

async fn read_header(from: &Path) -> Result<[u8; HEADER_BYTE_LENGTH], BoxedError> {
    let mut header = [0_u8; HEADER_BYTE_LENGTH];
    File::open(from).await?.read_exact(&mut header).await?;
    if &header[..MAGIC.len()] != MAGIC || header[4] & BLOCK_TYPE_MASK != STREAM_INFO_BLOCK {
        return Err(NOT_FLAC.into());
    }
    Ok(header)
}

fn read_counted(header: &[u8; HEADER_BYTE_LENGTH]) -> Result<u64, BoxedError> {
    Ok(read_packed(header)? & COUNTED_BITS)
}

fn read_packed(header: &[u8; HEADER_BYTE_LENGTH]) -> Result<u64, BoxedError> {
    let packed = header
        .get(COUNTED_OFFSET..COUNTED_OFFSET + size_of::<u64>())
        .and_then(|bytes| <[u8; 8]>::try_from(bytes).ok())
        .ok_or(NOT_FLAC)?;
    Ok(u64::from_be_bytes(packed))
}
