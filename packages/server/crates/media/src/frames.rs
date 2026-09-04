use std::path::Path;

use tokio::{fs::File, io::AsyncReadExt};

use crate::BoxedError;

const HEADER_BYTE_LENGTH: usize = 42;
const MAGIC: &[u8] = b"fLaC";
const STREAM_INFO_BLOCK: u8 = 0;
const BLOCK_TYPE_MASK: u8 = 0x7f;
const COUNTED_OFFSET: usize = 18;
const COUNTED_BITS: u64 = (1 << 36) - 1;
const NOT_FLAC: &str = "The audio master is not a flac stream";
const NO_FRAMES: &str = "The audio master holds no frames";

pub async fn read_frame_count(from: &Path) -> Result<u64, BoxedError> {
    let mut header = [0_u8; HEADER_BYTE_LENGTH];
    File::open(from).await?.read_exact(&mut header).await?;
    if &header[..MAGIC.len()] != MAGIC || header[4] & BLOCK_TYPE_MASK != STREAM_INFO_BLOCK {
        return Err(NOT_FLAC.into());
    }
    let counted = read_counted(&header)?;
    if counted == 0 {
        return Err(NO_FRAMES.into());
    }
    Ok(counted)
}

fn read_counted(header: &[u8; HEADER_BYTE_LENGTH]) -> Result<u64, BoxedError> {
    let packed = header
        .get(COUNTED_OFFSET..COUNTED_OFFSET + size_of::<u64>())
        .and_then(|bytes| <[u8; 8]>::try_from(bytes).ok())
        .ok_or(NOT_FLAC)?;
    Ok(u64::from_be_bytes(packed) & COUNTED_BITS)
}
