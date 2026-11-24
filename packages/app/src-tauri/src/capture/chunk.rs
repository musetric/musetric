const HEADER_VALUES: usize = 4;
const BYTES_PER_VALUE: usize = size_of::<f64>();
const BYTES_PER_SAMPLE: usize = size_of::<f32>();
const MS_PER_SECOND: f64 = 1000.0;

pub(crate) struct Packet<'samples> {
    pub(crate) capture_ms: Option<f64>,
    pub(crate) discontinuity: bool,
    pub(crate) samples: &'samples [f32],
}

pub(crate) struct ChunkFramer {
    session: f64,
    sample_rate: f64,
    chunk_frames: usize,
    frame: u64,
    end_ms: Option<f64>,
    start_ms: f64,
    start_frame: u64,
    samples: Vec<f32>,
}

#[expect(
    clippy::cast_precision_loss,
    reason = "a capture holds far fewer frames than f64 represents exactly"
)]
fn frames_as_f64(frames: u64) -> f64 {
    frames as f64
}

#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "the gap is rounded and positive, and far below u64::MAX frames"
)]
fn gap_frames(gap_ms: f64, sample_rate: f64) -> u64 {
    (gap_ms * sample_rate / MS_PER_SECOND).round().max(0.0) as u64
}

impl ChunkFramer {
    pub(crate) fn new(session: u32, sample_rate: u32, chunk_frames: usize) -> Self {
        Self {
            session: f64::from(session),
            sample_rate: f64::from(sample_rate),
            chunk_frames,
            frame: 0,
            end_ms: None,
            start_ms: 0.0,
            start_frame: 0,
            samples: Vec::with_capacity(chunk_frames * 2),
        }
    }

    pub(crate) fn push(&mut self, packet: &Packet<'_>, emit: &mut impl FnMut(Vec<u8>)) {
        let Some(capture_ms) = packet.capture_ms.or(self.end_ms) else {
            return;
        };
        if packet.discontinuity {
            self.flush(emit);
            if let Some(end_ms) = self.end_ms {
                self.frame += gap_frames(capture_ms - end_ms, self.sample_rate);
            }
        }
        if self.samples.is_empty() {
            self.start_ms = capture_ms;
            self.start_frame = self.frame;
        }
        let frames = packet.samples.len() as u64;
        self.samples.extend_from_slice(packet.samples);
        self.frame += frames;
        self.end_ms = Some(capture_ms + frames_as_f64(frames) * MS_PER_SECOND / self.sample_rate);
        if self.samples.len() >= self.chunk_frames {
            self.flush(emit);
        }
    }

    fn flush(&mut self, emit: &mut impl FnMut(Vec<u8>)) {
        if self.samples.is_empty() {
            return;
        }
        let mut bytes = Vec::with_capacity(
            HEADER_VALUES * BYTES_PER_VALUE + self.samples.len() * BYTES_PER_SAMPLE,
        );
        let header = [
            self.session,
            self.start_ms,
            self.sample_rate,
            frames_as_f64(self.start_frame),
        ];
        for value in header {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        for sample in &self.samples {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        self.samples.clear();
        emit(bytes);
    }
}

#[cfg(test)]
mod tests {
    use super::{BYTES_PER_SAMPLE, BYTES_PER_VALUE, ChunkFramer, HEADER_VALUES, Packet};

    const RATE: u32 = 48_000;
    const PACKET: usize = 480;
    const CHUNK: usize = 960;

    struct Chunk {
        session: f64,
        capture_ms: f64,
        sample_rate: f64,
        frame: f64,
        samples: Vec<f32>,
    }

    fn decode(bytes: &[u8]) -> Chunk {
        let (header, body) = bytes.split_at(HEADER_VALUES * BYTES_PER_VALUE);
        let values: Vec<f64> = header
            .as_chunks::<BYTES_PER_VALUE>()
            .0
            .iter()
            .map(|value| f64::from_le_bytes(*value))
            .collect();
        Chunk {
            session: values[0],
            capture_ms: values[1],
            sample_rate: values[2],
            frame: values[3],
            samples: body
                .as_chunks::<BYTES_PER_SAMPLE>()
                .0
                .iter()
                .map(|sample| f32::from_le_bytes(*sample))
                .collect(),
        }
    }

    fn ramp(from: usize) -> Vec<f32> {
        (from..from + PACKET)
            .map(|index| f32::from(u16::try_from(index).unwrap()))
            .collect()
    }

    fn run(packets: &[(Option<f64>, bool, Vec<f32>)]) -> Vec<Chunk> {
        let mut framer = ChunkFramer::new(7, RATE, CHUNK);
        let mut chunks = Vec::new();
        for (capture_ms, discontinuity, samples) in packets {
            framer.push(
                &Packet {
                    capture_ms: *capture_ms,
                    discontinuity: *discontinuity,
                    samples,
                },
                &mut |bytes| chunks.push(decode(&bytes)),
            );
        }
        chunks
    }

    #[test]
    fn joins_packets_into_chunks_timed_by_their_first_packet() {
        let chunks = run(&[
            (Some(100.0), false, ramp(0)),
            (Some(110.2), false, ramp(PACKET)),
            (Some(120.1), false, ramp(2 * PACKET)),
            (Some(130.0), false, ramp(3 * PACKET)),
        ]);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].session, 7.0);
        assert_eq!(chunks[0].sample_rate, f64::from(RATE));
        assert_eq!(chunks[0].capture_ms, 100.0);
        assert_eq!(chunks[0].frame, 0.0);
        assert_eq!(chunks[0].samples, [ramp(0), ramp(PACKET)].concat());
        assert_eq!(chunks[1].capture_ms, 120.1);
        assert_eq!(chunks[1].frame, 960.0);
        assert_eq!(chunks[1].samples.len(), CHUNK);
    }

    #[test]
    fn skips_the_frames_a_discontinuity_lost() {
        let chunks = run(&[
            (Some(100.0), false, ramp(0)),
            (Some(150.0), true, ramp(PACKET)),
            (Some(160.0), false, ramp(2 * PACKET)),
        ]);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].frame, 0.0);
        assert_eq!(chunks[0].samples, ramp(0));
        assert_eq!(chunks[1].capture_ms, 150.0);
        assert_eq!(chunks[1].frame, 2400.0);
        assert_eq!(chunks[1].samples, [ramp(PACKET), ramp(2 * PACKET)].concat());
    }

    #[test]
    fn times_a_packet_without_a_timestamp_by_the_one_before() {
        let chunks = run(&[
            (None, false, ramp(0)),
            (Some(100.0), false, ramp(PACKET)),
            (None, false, ramp(2 * PACKET)),
            (Some(130.0), false, ramp(3 * PACKET)),
            (None, false, ramp(4 * PACKET)),
            (Some(150.0), false, ramp(5 * PACKET)),
        ]);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].capture_ms, 100.0);
        assert_eq!(chunks[0].samples, [ramp(PACKET), ramp(2 * PACKET)].concat());
        assert_eq!(chunks[1].capture_ms, 130.0);
        assert_eq!(chunks[1].frame, 960.0);
        let late = run(&[
            (Some(100.0), false, ramp(0)),
            (Some(110.0), false, ramp(PACKET)),
            (None, false, ramp(2 * PACKET)),
            (None, false, ramp(3 * PACKET)),
        ]);
        assert_eq!(late[1].capture_ms, 120.0);
    }
}
