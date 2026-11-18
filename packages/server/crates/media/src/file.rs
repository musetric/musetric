use std::{fs::File, io::BufWriter, path::Path};

use crate::BoxedError;

const WRITE_BUFFER_BYTE_LENGTH: usize = 256 * 1024;

pub(crate) fn create_buffered(to: &Path) -> Result<BufWriter<File>, BoxedError> {
    Ok(BufWriter::with_capacity(
        WRITE_BUFFER_BYTE_LENGTH,
        File::create(to)?,
    ))
}
