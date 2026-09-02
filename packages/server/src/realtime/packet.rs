use musetric_db::BoxedError;

pub(crate) const HEADER_BYTE_LENGTH: usize = 8;
const MAX_BYTE_LENGTH: usize = 1024 * 1024;
const SAMPLE_BYTE_LENGTH: usize = 4;

pub(crate) struct StreamPacket {
    pub(crate) frame_index: u32,
    pub(crate) samples: Vec<f32>,
}

pub(crate) fn parse(packet: &[u8]) -> Result<StreamPacket, BoxedError> {
    let Some(header) = packet.get(..HEADER_BYTE_LENGTH) else {
        return Err("Recording packet is missing a header".into());
    };
    let frame_index = read_u32(header, 0);
    let frame_count = read_u32(header, 4) as usize;
    let byte_length = frame_count * SAMPLE_BYTE_LENGTH;
    if byte_length > MAX_BYTE_LENGTH {
        return Err(format!("Recording packet is too large: {byte_length}").into());
    }
    if packet.len() != HEADER_BYTE_LENGTH + byte_length {
        return Err("Recording packet has invalid byte length".into());
    }
    let samples = packet[HEADER_BYTE_LENGTH..]
        .chunks_exact(SAMPLE_BYTE_LENGTH)
        .map(read_f32)
        .collect();
    Ok(StreamPacket {
        frame_index,
        samples,
    })
}

pub(crate) fn create_chunk(frame_index: u32, samples: &[f32]) -> Result<Vec<u8>, BoxedError> {
    let frame_count = u32::try_from(samples.len())?;
    let mut packet = Vec::with_capacity(HEADER_BYTE_LENGTH + samples.len() * SAMPLE_BYTE_LENGTH);
    packet.extend_from_slice(&frame_index.to_le_bytes());
    packet.extend_from_slice(&frame_count.to_le_bytes());
    for sample in samples {
        packet.extend_from_slice(&sample.to_le_bytes());
    }
    Ok(packet)
}

fn read_u32(bytes: &[u8], offset: usize) -> u32 {
    let mut value = [0_u8; 4];
    value.copy_from_slice(&bytes[offset..offset + 4]);
    u32::from_le_bytes(value)
}

fn read_f32(bytes: &[u8]) -> f32 {
    let mut value = [0_u8; 4];
    value.copy_from_slice(bytes);
    f32::from_le_bytes(value)
}
