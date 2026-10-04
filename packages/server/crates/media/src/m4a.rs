use std::{
    fs::File,
    io::{BufWriter, Write},
    path::Path,
};

use crate::{
    BoxedError,
    aac::{ENCODER_DELAY, FRAME_SAMPLES},
    mp4box::{MediaTrack, box_of, movie_header, rate_index, tagged, track},
};

const MDAT_HEADER_BYTES: usize = 8;

pub(crate) struct M4aTrack<'track> {
    pub(crate) sample_rate: u32,
    pub(crate) channels: u8,
    pub(crate) packets: &'track [Vec<u8>],
    pub(crate) frame_count: u32,
}

pub(crate) fn write_m4a(to: &Path, layout: &M4aTrack<'_>) -> Result<(), BoxedError> {
    rate_index(layout.sample_rate)?;
    let file_type = box_of(*b"ftyp", &file_type_body());
    let movie_length = box_of(*b"moov", &movie_body(layout, 0)?).len();
    let data_offset = u32::try_from(file_type.len() + movie_length + MDAT_HEADER_BYTES)?;
    let movie = box_of(*b"moov", &movie_body(layout, data_offset)?);
    let payload: usize = layout.packets.iter().map(Vec::len).sum();
    let mut writer = BufWriter::new(File::create(to)?);
    writer.write_all(&file_type)?;
    writer.write_all(&movie)?;
    writer.write_all(&u32::try_from(payload + MDAT_HEADER_BYTES)?.to_be_bytes())?;
    writer.write_all(b"mdat")?;
    for packet in layout.packets {
        writer.write_all(packet)?;
    }
    writer.flush()?;
    Ok(())
}

fn file_type_body() -> Vec<u8> {
    let mut body = Vec::new();
    body.extend_from_slice(b"M4A ");
    body.extend_from_slice(&0_u32.to_be_bytes());
    body.extend_from_slice(b"M4A ");
    body.extend_from_slice(b"mp42");
    body.extend_from_slice(b"isom");
    body
}

fn movie_body(layout: &M4aTrack<'_>, data_offset: u32) -> Result<Vec<u8>, BoxedError> {
    let count = u32::try_from(layout.packets.len())?;
    let media = MediaTrack {
        sample_rate: layout.sample_rate,
        channels: layout.channels,
        duration: layout.frame_count,
        media_duration: count * FRAME_SAMPLES,
        priming: Some(ENCODER_DELAY),
    };
    let mut moov = movie_header(layout.sample_rate, layout.frame_count);
    moov.extend_from_slice(&track(&media, &sample_tables(layout.packets, data_offset)?));
    Ok(moov)
}

fn sample_tables(packets: &[Vec<u8>], data_offset: u32) -> Result<Vec<u8>, BoxedError> {
    let count = u32::try_from(packets.len())?;

    let mut times = Vec::new();
    times.extend_from_slice(&0_u32.to_be_bytes());
    times.extend_from_slice(&1_u32.to_be_bytes());
    times.extend_from_slice(&count.to_be_bytes());
    times.extend_from_slice(&FRAME_SAMPLES.to_be_bytes());

    let mut chunks = Vec::new();
    chunks.extend_from_slice(&0_u32.to_be_bytes());
    chunks.extend_from_slice(&1_u32.to_be_bytes());
    chunks.extend_from_slice(&1_u32.to_be_bytes());
    chunks.extend_from_slice(&count.to_be_bytes());
    chunks.extend_from_slice(&1_u32.to_be_bytes());

    let mut sizes = Vec::new();
    sizes.extend_from_slice(&0_u32.to_be_bytes());
    sizes.extend_from_slice(&0_u32.to_be_bytes());
    sizes.extend_from_slice(&count.to_be_bytes());
    for packet in packets {
        sizes.extend_from_slice(&u32::try_from(packet.len())?.to_be_bytes());
    }

    let mut offsets = Vec::new();
    offsets.extend_from_slice(&0_u32.to_be_bytes());
    offsets.extend_from_slice(&1_u32.to_be_bytes());
    offsets.extend_from_slice(&data_offset.to_be_bytes());

    let mut tables = box_of(*b"stts", &times);
    tagged(&mut tables, *b"stsc", &chunks);
    tagged(&mut tables, *b"stsz", &sizes);
    tagged(&mut tables, *b"stco", &offsets);
    Ok(tables)
}
