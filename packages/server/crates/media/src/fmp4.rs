use std::{
    fs::File,
    io::{BufWriter, Write},
    path::Path,
};

use crate::{BoxedError, aac::FRAME_SAMPLES};

const FRAGMENT_SAMPLES: u64 = 96_000;
const LANGUAGE: u16 = 0x55C4;
const MOVIE_TIMESCALE: u32 = 1000;
const UNITY_RATE: u32 = 0x0001_0000;
const AAC_PROFILE: u8 = 2;
const MP4A_OBJECT_TYPE: u8 = 0x40;
const AUDIO_STREAM_TYPE: u8 = 0x15;
const SL_CONFIG_PREDEFINED: u8 = 0x02;
const ELEMENTARY_STREAM_TAG: u8 = 0x03;
const DECODER_CONFIG_TAG: u8 = 0x04;
const DECODER_SPECIFIC_TAG: u8 = 0x05;
const SL_CONFIG_TAG: u8 = 0x06;
const TRACK_ID: u32 = 1;
const ES_ID: u16 = 1;
const DEFAULT_BASE_IS_MOOF: u32 = 0x0002_0000;
const RUN_FLAGS: u32 = 0x0000_0301;
const RATE_TABLE: [u32; 13] = [
    96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000, 22_050, 16_000, 12_000, 11_025, 8_000,
    7_350,
];
const UNSUPPORTED_RATE: &str = "The delivery sample rate is not an AAC rate";
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

fn box_of(kind: [u8; 4], body: &[u8]) -> Vec<u8> {
    let size = u32::try_from(body.len() + 8).unwrap_or(0);
    let mut out = Vec::with_capacity(body.len() + 8);
    out.extend_from_slice(&size.to_be_bytes());
    out.extend_from_slice(&kind);
    out.extend_from_slice(body);
    out
}

fn tagged(out: &mut Vec<u8>, kind: [u8; 4], body: &[u8]) {
    out.extend_from_slice(&box_of(kind, body));
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
    let mut movie_header = Vec::new();
    movie_header.extend_from_slice(&0_u32.to_be_bytes());
    movie_header.extend_from_slice(&0_u32.to_be_bytes());
    movie_header.extend_from_slice(&0_u32.to_be_bytes());
    movie_header.extend_from_slice(&MOVIE_TIMESCALE.to_be_bytes());
    movie_header.extend_from_slice(&0_u32.to_be_bytes());
    movie_header.extend_from_slice(&UNITY_RATE.to_be_bytes());
    movie_header.extend_from_slice(&0x0100_u16.to_be_bytes());
    movie_header.extend_from_slice(&[0; 10]);
    movie_header.extend_from_slice(&unity_matrix());
    movie_header.extend_from_slice(&[0; 24]);
    movie_header.extend_from_slice(&2_u32.to_be_bytes());

    let mut tkhd = Vec::new();
    tkhd.extend_from_slice(&3_u32.to_be_bytes());
    tkhd.extend_from_slice(&0_u32.to_be_bytes());
    tkhd.extend_from_slice(&0_u32.to_be_bytes());
    tkhd.extend_from_slice(&TRACK_ID.to_be_bytes());
    tkhd.extend_from_slice(&0_u32.to_be_bytes());
    tkhd.extend_from_slice(&0_u32.to_be_bytes());
    tkhd.extend_from_slice(&0_u32.to_be_bytes());
    tkhd.extend_from_slice(&0_u32.to_be_bytes());
    tkhd.extend_from_slice(&0_u16.to_be_bytes());
    tkhd.extend_from_slice(&0_u16.to_be_bytes());
    tkhd.extend_from_slice(&0x0100_u16.to_be_bytes());
    tkhd.extend_from_slice(&0_u16.to_be_bytes());
    tkhd.extend_from_slice(&unity_matrix());
    tkhd.extend_from_slice(&0_u32.to_be_bytes());
    tkhd.extend_from_slice(&0_u32.to_be_bytes());

    let mut media_header = Vec::new();
    media_header.extend_from_slice(&0_u32.to_be_bytes());
    media_header.extend_from_slice(&0_u32.to_be_bytes());
    media_header.extend_from_slice(&0_u32.to_be_bytes());
    media_header.extend_from_slice(&sample_rate.to_be_bytes());
    media_header.extend_from_slice(&0_u32.to_be_bytes());
    media_header.extend_from_slice(&LANGUAGE.to_be_bytes());
    media_header.extend_from_slice(&0_u16.to_be_bytes());

    let mut hdlr = Vec::new();
    hdlr.extend_from_slice(&0_u32.to_be_bytes());
    hdlr.extend_from_slice(&0_u32.to_be_bytes());
    hdlr.extend_from_slice(b"soun");
    hdlr.extend_from_slice(&[0; 12]);
    hdlr.extend_from_slice(b"SoundHandler\0");

    let mut smhd = Vec::new();
    smhd.extend_from_slice(&0_u32.to_be_bytes());
    smhd.extend_from_slice(&0_u16.to_be_bytes());
    smhd.extend_from_slice(&0_u16.to_be_bytes());

    let mut url = Vec::new();
    url.extend_from_slice(&1_u32.to_be_bytes());
    let mut dref = Vec::new();
    dref.extend_from_slice(&0_u32.to_be_bytes());
    dref.extend_from_slice(&1_u32.to_be_bytes());
    dref.extend_from_slice(&box_of(*b"url ", &url));

    let mut stsz = Vec::new();
    stsz.extend_from_slice(&0_u32.to_be_bytes());
    stsz.extend_from_slice(&0_u32.to_be_bytes());
    stsz.extend_from_slice(&0_u32.to_be_bytes());

    let empty_table = [[0_u8; 4], [0_u8; 4]].concat();
    let mut stbl = box_of(*b"stsd", &sample_description(sample_rate, channels));
    stbl.extend_from_slice(&box_of(*b"stts", &empty_table));
    stbl.extend_from_slice(&box_of(*b"stsc", &empty_table));
    stbl.extend_from_slice(&box_of(*b"stsz", &stsz));
    stbl.extend_from_slice(&box_of(*b"stco", &empty_table));

    let mut minf = box_of(*b"smhd", &smhd);
    minf.extend_from_slice(&box_of(*b"dinf", &box_of(*b"dref", &dref)));
    minf.extend_from_slice(&box_of(*b"stbl", &stbl));

    let mut mdia = box_of(*b"mdhd", &media_header);
    mdia.extend_from_slice(&box_of(*b"hdlr", &hdlr));
    mdia.extend_from_slice(&box_of(*b"minf", &minf));

    let mut trak = box_of(*b"tkhd", &tkhd);
    trak.extend_from_slice(&box_of(*b"mdia", &mdia));

    let mut trex = Vec::new();
    trex.extend_from_slice(&0_u32.to_be_bytes());
    trex.extend_from_slice(&TRACK_ID.to_be_bytes());
    trex.extend_from_slice(&1_u32.to_be_bytes());
    trex.extend_from_slice(&FRAME_SAMPLES.to_be_bytes());
    trex.extend_from_slice(&0_u32.to_be_bytes());
    trex.extend_from_slice(&0_u32.to_be_bytes());
    let mvex = box_of(*b"trex", &trex);

    let mut moov = box_of(*b"mvhd", &movie_header);
    moov.extend_from_slice(&box_of(*b"trak", &trak));
    moov.extend_from_slice(&box_of(*b"mvex", &mvex));
    moov
}

fn sample_description(sample_rate: u32, channels: u8) -> Vec<u8> {
    let mut mp4a = Vec::new();
    mp4a.extend_from_slice(&[0; 6]);
    mp4a.extend_from_slice(&1_u16.to_be_bytes());
    mp4a.extend_from_slice(&[0; 8]);
    mp4a.extend_from_slice(&u16::from(channels).to_be_bytes());
    mp4a.extend_from_slice(&16_u16.to_be_bytes());
    mp4a.extend_from_slice(&0_u16.to_be_bytes());
    mp4a.extend_from_slice(&0_u16.to_be_bytes());
    mp4a.extend_from_slice(&(sample_rate << 16).to_be_bytes());
    mp4a.extend_from_slice(&box_of(*b"esds", &esds_body(sample_rate, channels)));

    let mut stsd = Vec::new();
    stsd.extend_from_slice(&0_u32.to_be_bytes());
    stsd.extend_from_slice(&1_u32.to_be_bytes());
    stsd.extend_from_slice(&box_of(*b"mp4a", &mp4a));
    stsd
}

fn esds_body(sample_rate: u32, channels: u8) -> Vec<u8> {
    let mut config = Vec::new();
    config.extend_from_slice(&[MP4A_OBJECT_TYPE, AUDIO_STREAM_TYPE, 0, 0, 0]);
    config.extend_from_slice(&0_u32.to_be_bytes());
    config.extend_from_slice(&0_u32.to_be_bytes());
    let specific = audio_specific_config(sample_rate, channels);
    descriptor(&mut config, DECODER_SPECIFIC_TAG, &specific);

    let mut stream = Vec::new();
    stream.extend_from_slice(&ES_ID.to_be_bytes());
    stream.push(0);
    descriptor(&mut stream, DECODER_CONFIG_TAG, &config);
    descriptor(&mut stream, SL_CONFIG_TAG, &[SL_CONFIG_PREDEFINED]);

    let mut esds = vec![0, 0, 0, 0];
    descriptor(&mut esds, ELEMENTARY_STREAM_TAG, &stream);
    esds
}

fn descriptor(out: &mut Vec<u8>, tag: u8, body: &[u8]) {
    out.push(tag);
    out.push(u8::try_from(body.len()).unwrap_or(0));
    out.extend_from_slice(body);
}

fn audio_specific_config(sample_rate: u32, channels: u8) -> [u8; 2] {
    let index = u8::try_from(rate_index(sample_rate).unwrap_or(0)).unwrap_or(0);
    [
        (AAC_PROFILE << 3) | ((index & 0x0e) >> 1),
        ((index & 0x01) << 7) | (channels << 3),
    ]
}

fn rate_index(sample_rate: u32) -> Result<usize, BoxedError> {
    RATE_TABLE
        .iter()
        .position(|rate| *rate == sample_rate)
        .ok_or(UNSUPPORTED_RATE.into())
}

fn unity_matrix() -> [u8; 36] {
    let mut matrix = [0; 36];
    matrix[0..4].copy_from_slice(&UNITY_RATE.to_be_bytes());
    matrix[16..20].copy_from_slice(&UNITY_RATE.to_be_bytes());
    matrix[32..36].copy_from_slice(&0x4000_0000_u32.to_be_bytes());
    matrix
}
