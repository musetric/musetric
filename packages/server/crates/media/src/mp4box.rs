use crate::BoxedError;

pub(crate) const TRACK_ID: u32 = 1;
const LANGUAGE: u16 = 0x55C4;
const UNITY_RATE: u32 = 0x0001_0000;
const UNITY_MEDIA_RATE: u16 = 1;
const AAC_PROFILE: u8 = 2;
const MP4A_OBJECT_TYPE: u8 = 0x40;
const AUDIO_STREAM_TYPE: u8 = 0x15;
const SL_CONFIG_PREDEFINED: u8 = 0x02;
const ELEMENTARY_STREAM_TAG: u8 = 0x03;
const DECODER_CONFIG_TAG: u8 = 0x04;
const DECODER_SPECIFIC_TAG: u8 = 0x05;
const SL_CONFIG_TAG: u8 = 0x06;
const ES_ID: u16 = 1;
const RATE_TABLE: [u32; 13] = [
    96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000, 22_050, 16_000, 12_000, 11_025, 8_000,
    7_350,
];
const UNSUPPORTED_RATE: &str = "The sample rate is not an AAC rate";

pub(crate) struct MediaTrack {
    pub(crate) sample_rate: u32,
    pub(crate) channels: u8,
    pub(crate) duration: u32,
    pub(crate) media_duration: u32,
    pub(crate) priming: Option<u32>,
}

pub(crate) fn box_of(kind: [u8; 4], body: &[u8]) -> Vec<u8> {
    let size = u32::try_from(body.len() + 8).unwrap_or(0);
    let mut out = Vec::with_capacity(body.len() + 8);
    out.extend_from_slice(&size.to_be_bytes());
    out.extend_from_slice(&kind);
    out.extend_from_slice(body);
    out
}

pub(crate) fn tagged(out: &mut Vec<u8>, kind: [u8; 4], body: &[u8]) {
    out.extend_from_slice(&box_of(kind, body));
}

pub(crate) fn rate_index(sample_rate: u32) -> Result<usize, BoxedError> {
    RATE_TABLE
        .iter()
        .position(|rate| *rate == sample_rate)
        .ok_or(UNSUPPORTED_RATE.into())
}

pub(crate) fn movie_header(timescale: u32, duration: u32) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend_from_slice(&0_u32.to_be_bytes());
    body.extend_from_slice(&0_u32.to_be_bytes());
    body.extend_from_slice(&0_u32.to_be_bytes());
    body.extend_from_slice(&timescale.to_be_bytes());
    body.extend_from_slice(&duration.to_be_bytes());
    body.extend_from_slice(&UNITY_RATE.to_be_bytes());
    body.extend_from_slice(&0x0100_u16.to_be_bytes());
    body.extend_from_slice(&[0; 10]);
    body.extend_from_slice(&unity_matrix());
    body.extend_from_slice(&[0; 24]);
    body.extend_from_slice(&2_u32.to_be_bytes());
    box_of(*b"mvhd", &body)
}

pub(crate) fn track(media: &MediaTrack, sample_tables: &[u8]) -> Vec<u8> {
    let mut body = box_of(*b"tkhd", &track_header(media.duration));
    if let Some(priming) = media.priming {
        let edits = box_of(*b"elst", &edit_list(media.duration, priming));
        tagged(&mut body, *b"edts", &edits);
    }
    tagged(&mut body, *b"mdia", &media_body(media, sample_tables));
    box_of(*b"trak", &body)
}

fn track_header(duration: u32) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend_from_slice(&3_u32.to_be_bytes());
    body.extend_from_slice(&0_u32.to_be_bytes());
    body.extend_from_slice(&0_u32.to_be_bytes());
    body.extend_from_slice(&TRACK_ID.to_be_bytes());
    body.extend_from_slice(&0_u32.to_be_bytes());
    body.extend_from_slice(&duration.to_be_bytes());
    body.extend_from_slice(&0_u32.to_be_bytes());
    body.extend_from_slice(&0_u32.to_be_bytes());
    body.extend_from_slice(&0_u16.to_be_bytes());
    body.extend_from_slice(&0_u16.to_be_bytes());
    body.extend_from_slice(&0x0100_u16.to_be_bytes());
    body.extend_from_slice(&0_u16.to_be_bytes());
    body.extend_from_slice(&unity_matrix());
    body.extend_from_slice(&0_u32.to_be_bytes());
    body.extend_from_slice(&0_u32.to_be_bytes());
    body
}

fn edit_list(duration: u32, priming: u32) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend_from_slice(&0_u32.to_be_bytes());
    body.extend_from_slice(&1_u32.to_be_bytes());
    body.extend_from_slice(&duration.to_be_bytes());
    body.extend_from_slice(&priming.to_be_bytes());
    body.extend_from_slice(&UNITY_MEDIA_RATE.to_be_bytes());
    body.extend_from_slice(&0_u16.to_be_bytes());
    body
}

fn media_body(media: &MediaTrack, sample_tables: &[u8]) -> Vec<u8> {
    let mut media_header = Vec::new();
    media_header.extend_from_slice(&0_u32.to_be_bytes());
    media_header.extend_from_slice(&0_u32.to_be_bytes());
    media_header.extend_from_slice(&0_u32.to_be_bytes());
    media_header.extend_from_slice(&media.sample_rate.to_be_bytes());
    media_header.extend_from_slice(&media.media_duration.to_be_bytes());
    media_header.extend_from_slice(&LANGUAGE.to_be_bytes());
    media_header.extend_from_slice(&0_u16.to_be_bytes());

    let mut handler = Vec::new();
    handler.extend_from_slice(&0_u32.to_be_bytes());
    handler.extend_from_slice(&0_u32.to_be_bytes());
    handler.extend_from_slice(b"soun");
    handler.extend_from_slice(&[0; 12]);
    handler.extend_from_slice(b"SoundHandler\0");

    let mut body = box_of(*b"mdhd", &media_header);
    tagged(&mut body, *b"hdlr", &handler);
    tagged(
        &mut body,
        *b"minf",
        &media_information(media, sample_tables),
    );
    body
}

fn media_information(media: &MediaTrack, sample_tables: &[u8]) -> Vec<u8> {
    let mut sound_header = Vec::new();
    sound_header.extend_from_slice(&0_u32.to_be_bytes());
    sound_header.extend_from_slice(&0_u16.to_be_bytes());
    sound_header.extend_from_slice(&0_u16.to_be_bytes());

    let mut url = Vec::new();
    url.extend_from_slice(&1_u32.to_be_bytes());
    let mut references = Vec::new();
    references.extend_from_slice(&0_u32.to_be_bytes());
    references.extend_from_slice(&1_u32.to_be_bytes());
    tagged(&mut references, *b"url ", &url);

    let mut table = box_of(
        *b"stsd",
        &sample_description(media.sample_rate, media.channels),
    );
    table.extend_from_slice(sample_tables);

    let mut body = box_of(*b"smhd", &sound_header);
    tagged(&mut body, *b"dinf", &box_of(*b"dref", &references));
    tagged(&mut body, *b"stbl", &table);
    body
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
    tagged(&mut mp4a, *b"esds", &esds_body(sample_rate, channels));

    let mut description = Vec::new();
    description.extend_from_slice(&0_u32.to_be_bytes());
    description.extend_from_slice(&1_u32.to_be_bytes());
    tagged(&mut description, *b"mp4a", &mp4a);
    description
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

fn unity_matrix() -> [u8; 36] {
    let mut matrix = [0; 36];
    matrix[0..4].copy_from_slice(&UNITY_RATE.to_be_bytes());
    matrix[16..20].copy_from_slice(&UNITY_RATE.to_be_bytes());
    matrix[32..36].copy_from_slice(&0x4000_0000_u32.to_be_bytes());
    matrix
}
