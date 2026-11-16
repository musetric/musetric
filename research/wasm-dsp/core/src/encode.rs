use flacenc::{
    bitsink::ByteSink,
    component::{BitRepr, Stream},
    config::Encoder as Configuration,
    encode_fixed_size_frame,
    error::{Verified, Verify},
    source::{Context, Fill, FrameBuf},
};
use rusty_mp3::{Error as Mp3Error, Mp3Encoder, Mp3EncoderConfig};

use crate::{BoxedError, aac::AacEncoder, depth::SampleDepth, pcm::CHANNELS};

const BLOCK_FRAMES: usize = 4096;
const FRAME_OVERHEAD_BYTES: usize = 32;
const ENCODED_FRAMES: usize = 65_536;

fn describe(failure: impl std::fmt::Display) -> BoxedError {
    failure.to_string().into()
}

fn verify(configuration: Configuration) -> Result<Verified<Configuration>, BoxedError> {
    configuration
        .into_verified()
        .map_err(|(_, failure)| describe(failure))
}

fn verbatim_configuration() -> Configuration {
    let mut configuration = Configuration::default();
    configuration.subframe_coding.use_fixed = false;
    configuration.subframe_coding.use_lpc = false;
    configuration
}

fn encode_frame(
    configuration: &Verified<Configuration>,
    frames: &FrameBuf,
    number: usize,
    stream: &Stream,
) -> Result<ByteSink, BoxedError> {
    let frame = encode_fixed_size_frame(configuration, frames, number, stream.stream_info())
        .map_err(describe)?;
    let mut sink = ByteSink::new();
    frame.write(&mut sink).map_err(describe)?;
    Ok(sink)
}

pub fn encode_flac(interleaved: &[f32], sample_rate: u32) -> Result<Vec<u8>, BoxedError> {
    let depth = SampleDepth::Sixteen;
    let configuration = verify(Configuration::default())?;
    let verbatim = verify(verbatim_configuration())?;
    let mut stream =
        Stream::new(usize::try_from(sample_rate)?, CHANNELS, depth.bits()).map_err(describe)?;
    stream
        .stream_info_mut()
        .set_block_sizes(BLOCK_FRAMES, BLOCK_FRAMES)
        .map_err(describe)?;
    let mut frames = FrameBuf::with_size(CHANNELS, BLOCK_FRAMES).map_err(describe)?;
    let mut context = Context::new(depth.bits(), CHANNELS);
    let mut out = Vec::with_capacity(interleaved.len());
    let mut pending = Vec::with_capacity(BLOCK_FRAMES * CHANNELS);
    for block in interleaved.chunks(BLOCK_FRAMES * CHANNELS) {
        pending.clear();
        pending.extend(block.iter().map(|value| depth.quantize(*value)));
        (&mut frames, &mut context)
            .fill_interleaved(&pending)
            .map_err(describe)?;
        let number = context
            .current_frame_number()
            .ok_or("The flac writer lost the frame number")?;
        let mut sink = encode_frame(&configuration, &frames, number, &stream)?;
        if sink.as_slice().len() > pending.len() * depth.bytes() + FRAME_OVERHEAD_BYTES {
            sink = encode_frame(&verbatim, &frames, number, &stream)?;
        }
        out.extend_from_slice(sink.as_slice());
    }
    let digest = context.md5_digest();
    let info = stream.stream_info_mut();
    info.set_total_samples(context.total_samples());
    info.set_md5_digest(&digest);
    Ok(out)
}

pub fn encode_aac(
    interleaved: &[f32],
    sample_rate: u32,
    bitrate: u32,
) -> Result<Vec<u8>, BoxedError> {
    let mut encoder = AacEncoder::create(sample_rate, 2, bitrate)?;
    for chunk in interleaved.chunks(ENCODED_FRAMES * CHANNELS) {
        encoder.push(chunk)?;
    }
    Ok(encoder.finish()?.concat())
}

pub fn encode_mp3(
    interleaved: &[f32],
    sample_rate: u32,
    bitrate: u32,
) -> Result<Vec<u8>, BoxedError> {
    let mut encoder = Mp3Encoder::new(Mp3EncoderConfig {
        bitrate_kbps: bitrate / 1000,
        vbr_quality: None,
    });
    for chunk in interleaved.chunks(ENCODED_FRAMES * CHANNELS) {
        encoder.push_pcm_f32(chunk, u16::try_from(CHANNELS)?, sample_rate)?;
    }
    encoder.finish();
    let mut out = Vec::new();
    loop {
        match encoder.next_packet() {
            Ok(packet) => out.extend_from_slice(&packet),
            Err(Mp3Error::Eof) => break,
            Err(failure) => return Err(failure.into()),
        }
    }
    Ok(out)
}
