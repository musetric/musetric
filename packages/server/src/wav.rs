const HEADER_BYTE_LENGTH: usize = 44;
const BYTES_PER_SAMPLE: u16 = 2;
const BITS_PER_SAMPLE: u16 = 16;
const PCM_FORMAT: u16 = 1;
const CHANNEL_COUNT: u16 = 1;
const FORMAT_CHUNK_BYTE_LENGTH: u32 = 16;
const RIFF_HEADER_BYTE_LENGTH: u32 = 36;
const DEFAULT_SAMPLE_RATE: u32 = 48000;

pub(crate) const CONTENT_TYPE: &str = "audio/wav";

pub(crate) fn create_empty() -> Vec<u8> {
    create_header(0, DEFAULT_SAMPLE_RATE)
}

fn create_header(frame_count: u32, sample_rate: u32) -> Vec<u8> {
    let bytes_per_sample = u32::from(BYTES_PER_SAMPLE);
    let data_byte_length = frame_count * bytes_per_sample;
    let mut header = Vec::with_capacity(HEADER_BYTE_LENGTH);
    header.extend_from_slice(b"RIFF");
    header.extend_from_slice(&(RIFF_HEADER_BYTE_LENGTH + data_byte_length).to_le_bytes());
    header.extend_from_slice(b"WAVE");
    header.extend_from_slice(b"fmt ");
    header.extend_from_slice(&FORMAT_CHUNK_BYTE_LENGTH.to_le_bytes());
    header.extend_from_slice(&PCM_FORMAT.to_le_bytes());
    header.extend_from_slice(&CHANNEL_COUNT.to_le_bytes());
    header.extend_from_slice(&sample_rate.to_le_bytes());
    header.extend_from_slice(&(sample_rate * bytes_per_sample).to_le_bytes());
    header.extend_from_slice(&BYTES_PER_SAMPLE.to_le_bytes());
    header.extend_from_slice(&BITS_PER_SAMPLE.to_le_bytes());
    header.extend_from_slice(b"data");
    header.extend_from_slice(&data_byte_length.to_le_bytes());
    header
}

#[cfg(test)]
mod tests {
    use super::create_header;

    #[test]
    fn writes_the_same_header_the_node_recorder_writes() {
        let header = create_header(0, 48000);

        assert_eq!(
            header,
            b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x80\xbb\x00\x00\x00\x77\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00"
        );
    }
}
