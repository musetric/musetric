use std::path::Path;

use tokio::{fs::File, io::AsyncReadExt};

use crate::run::BoxedError;

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

#[cfg(test)]
mod tests {
    use super::read_frame_count;
    use crate::{
        convert::encode_flac_from_raw,
        fixture::{Fixture, Signal},
        resample::SampleRates,
    };

    const SAMPLE_RATE: u32 = 48000;
    const SECONDS: f64 = 2.0;
    const TONE: &str = "0.5*sin(440*2*PI*t)|0.5*sin(523.25*2*PI*t)";

    fn tone(name: &str) -> Signal<'_> {
        Signal {
            name,
            expression: TONE,
            seconds: SECONDS,
            sample_rate: SAMPLE_RATE,
        }
    }

    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "the fixture is two whole seconds of audio"
    )]
    fn expected() -> u64 {
        (SECONDS * f64::from(SAMPLE_RATE)) as u64
    }

    #[tokio::test]
    async fn counts_the_frames_of_a_master_this_crate_wrote() {
        let fixture = Fixture::create();
        let raw = fixture.write_raw(&tone("stem.f32")).await;
        let master = fixture.join("master.flac");
        let rates = SampleRates {
            input: SAMPLE_RATE,
            output: SAMPLE_RATE,
        };
        encode_flac_from_raw(&raw, &master, rates)
            .await
            .expect("the stem should be encoded");

        let counted = read_frame_count(&master)
            .await
            .expect("the master should be counted");

        assert_eq!(counted, expected());
    }

    #[tokio::test]
    async fn counts_the_frames_of_a_master_ffmpeg_wrote() {
        let fixture = Fixture::create();
        let master = fixture.write_flac(&tone("master.flac")).await;

        let counted = read_frame_count(&master)
            .await
            .expect("the master should be counted");

        assert_eq!(counted, expected());
    }

    #[tokio::test]
    async fn refuses_a_file_that_is_not_a_flac_stream() {
        let fixture = Fixture::create();
        let source = fixture.write_wav(&tone("source.wav")).await;

        let refused = read_frame_count(&source).await;

        assert!(refused.is_err());
    }
}
