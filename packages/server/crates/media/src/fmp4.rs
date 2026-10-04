use std::{
    fs::File,
    io::{BufWriter, Write},
    path::Path,
};

use crate::{
    BoxedError,
    aac::FRAME_SAMPLES,
    mp4box::{MediaTrack, TRACK_ID, box_of, movie_header, rate_index, tagged, track},
};

const FRAGMENT_SAMPLES: u64 = 96_000;
const MOVIE_TIMESCALE: u32 = 1000;
const DEFAULT_BASE_IS_MOOF: u32 = 0x0002_0000;
const RUN_FLAGS: u32 = 0x0000_0301;
const MOOF_TO_DATA: usize = 40;

struct Packet {
    data: Vec<u8>,
    duration: u32,
}

pub(crate) struct Fmp4Writer {
    writer: BufWriter<File>,
    sequence: u32,
    base_time: u32,
    fragment: Vec<Packet>,
    fragment_samples: u64,
}

impl Fmp4Writer {
    pub(crate) fn create(to: &Path, sample_rate: u32, channels: u8) -> Result<Self, BoxedError> {
        rate_index(sample_rate)?;
        let mut writer = BufWriter::new(File::create(to)?);
        writer.write_all(&box_of(*b"ftyp", &file_type_body()))?;
        writer.write_all(&box_of(*b"moov", &movie_body(sample_rate, channels)))?;
        writer.flush()?;
        Ok(Self {
            writer,
            sequence: 1,
            base_time: 0,
            fragment: Vec::new(),
            fragment_samples: 0,
        })
    }

    pub(crate) fn push(&mut self, packet: &[u8], samples: u32) -> Result<(), BoxedError> {
        self.fragment_samples += u64::from(samples);
        self.fragment.push(Packet {
            data: packet.to_vec(),
            duration: samples,
        });
        if self.fragment_samples >= FRAGMENT_SAMPLES {
            self.emit()?;
        }
        Ok(())
    }

    pub(crate) fn finish(mut self) -> Result<(), BoxedError> {
        if !self.fragment.is_empty() {
            self.emit()?;
        }
        self.writer.flush()?;
        Ok(())
    }

    fn emit(&mut self) -> Result<(), BoxedError> {
        let mut traf = Vec::new();
        let mut tfhd = Vec::new();
        tfhd.extend_from_slice(&DEFAULT_BASE_IS_MOOF.to_be_bytes());
        tfhd.extend_from_slice(&TRACK_ID.to_be_bytes());
        tagged(&mut traf, *b"tfhd", &tfhd);
        let mut tfdt = Vec::new();
        tfdt.extend_from_slice(&0_u32.to_be_bytes());
        tfdt.extend_from_slice(&self.base_time.to_be_bytes());
        tagged(&mut traf, *b"tfdt", &tfdt);
        let mut trun = Vec::new();
        trun.extend_from_slice(&RUN_FLAGS.to_be_bytes());
        trun.extend_from_slice(&u32::try_from(self.fragment.len())?.to_be_bytes());
        trun.extend_from_slice(&0_u32.to_be_bytes());
        for packet in &self.fragment {
            trun.extend_from_slice(&packet.duration.to_be_bytes());
            trun.extend_from_slice(&u32::try_from(packet.data.len())?.to_be_bytes());
        }
        let offset_position = traf.len() + 16;
        tagged(&mut traf, *b"trun", &trun);
        let data_offset = u32::try_from(traf.len() + MOOF_TO_DATA)?;
        traf[offset_position..offset_position + 4].copy_from_slice(&data_offset.to_be_bytes());
        let mut moof_body = Vec::new();
        let mut mfhd = Vec::new();
        mfhd.extend_from_slice(&0_u32.to_be_bytes());
        mfhd.extend_from_slice(&self.sequence.to_be_bytes());
        tagged(&mut moof_body, *b"mfhd", &mfhd);
        tagged(&mut moof_body, *b"traf", &traf);
        let mut payload = Vec::new();
        for packet in &self.fragment {
            payload.extend_from_slice(&packet.data);
        }
        self.writer.write_all(&box_of(*b"moof", &moof_body))?;
        self.writer
            .write_all(&u32::try_from(payload.len() + 8)?.to_be_bytes())?;
        self.writer.write_all(b"mdat")?;
        self.writer.write_all(&payload)?;
        self.sequence += 1;
        self.base_time = u32::try_from(u64::from(self.base_time) + self.fragment_samples)?;
        self.fragment = Vec::new();
        self.fragment_samples = 0;
        Ok(())
    }
}

fn file_type_body() -> Vec<u8> {
    let mut body = Vec::new();
    body.extend_from_slice(b"isom");
    body.extend_from_slice(&512_u32.to_be_bytes());
    body.extend_from_slice(b"isom");
    body.extend_from_slice(b"iso2");
    body.extend_from_slice(b"mp41");
    body
}

fn movie_body(sample_rate: u32, channels: u8) -> Vec<u8> {
    let empty_table = [0_u8; 8];
    let mut tables = box_of(*b"stts", &empty_table);
    tagged(&mut tables, *b"stsc", &empty_table);
    tagged(&mut tables, *b"stsz", &[0_u8; 12]);
    tagged(&mut tables, *b"stco", &empty_table);
    let media = MediaTrack {
        sample_rate,
        channels,
        duration: 0,
        media_duration: 0,
        priming: None,
    };

    let mut trex = Vec::new();
    trex.extend_from_slice(&0_u32.to_be_bytes());
    trex.extend_from_slice(&TRACK_ID.to_be_bytes());
    trex.extend_from_slice(&1_u32.to_be_bytes());
    trex.extend_from_slice(&FRAME_SAMPLES.to_be_bytes());
    trex.extend_from_slice(&0_u32.to_be_bytes());
    trex.extend_from_slice(&0_u32.to_be_bytes());

    let mut moov = movie_header(MOVIE_TIMESCALE, 0);
    moov.extend_from_slice(&track(&media, &tables));
    tagged(&mut moov, *b"mvex", &box_of(*b"trex", &trex));
    moov
}
