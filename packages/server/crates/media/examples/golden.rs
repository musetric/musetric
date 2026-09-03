#![allow(
    clippy::expect_used,
    clippy::print_stdout,
    clippy::too_many_lines,
    reason = "the golden generator is a developer script run by hand, not shipped code"
)]

use std::{
    fs::write,
    process::{Command, Stdio},
};

const RATE: u32 = 48_000;
const OUT: &str = "crates/media/fixtures";
const REFERENCE: &str = "ffmpeg";

struct Partial {
    frequency: f32,
    amplitude: f32,
    phase: f32,
}

struct Signal {
    left: Vec<Partial>,
    right: Vec<Partial>,
    seconds: f64,
    gate: Option<fn(f32) -> f32>,
}

#[expect(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "the fixture length and time base stay far below the exact range of the target types"
)]
fn render(signal: &Signal, rate: u32) -> Vec<f32> {
    let count = (signal.seconds * f64::from(rate)) as usize;
    let mut samples = Vec::with_capacity(count * 2);
    for index in 0..count {
        let time = index as f32 / rate as f32;
        let gate = signal.gate.map_or(1.0, |gate| gate(time));
        samples.push(mix(&signal.left, time) * gate);
        samples.push(mix(&signal.right, time) * gate);
    }
    samples
}

fn mix(partials: &[Partial], time: f32) -> f32 {
    partials
        .iter()
        .map(|partial| {
            partial.amplitude
                * (2.0 * std::f32::consts::PI * partial.frequency * time + partial.phase).sin()
        })
        .sum()
}

fn partial(frequency: f32, amplitude: f32, phase: f32) -> Partial {
    Partial {
        frequency,
        amplitude,
        phase,
    }
}

fn decode_tone() -> Signal {
    Signal {
        left: vec![partial(440.0, 0.6, 0.0), partial(523.25, 0.3, 0.0)],
        right: vec![partial(330.0, 0.5, 0.0), partial(659.26, 0.25, 0.0)],
        seconds: 1.0,
        gate: None,
    }
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "the sample is rounded and clamped into the target width before the cast"
)]
fn wav_bytes(samples: &[f32], bytes_per_sample: usize, channels: usize, rate: u32) -> Vec<u8> {
    let data_length = samples.len() * bytes_per_sample;
    let mut bytes = Vec::with_capacity(data_length + 44);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&u32::try_from(data_length + 36).unwrap_or(0).to_le_bytes());
    bytes.extend_from_slice(b"WAVE");
    bytes.extend_from_slice(b"fmt ");
    bytes.extend_from_slice(&16_u32.to_le_bytes());
    bytes.extend_from_slice(&1_u16.to_le_bytes());
    bytes.extend_from_slice(&u16::try_from(channels).unwrap_or(0).to_le_bytes());
    bytes.extend_from_slice(&rate.to_le_bytes());
    let block = u32::try_from(rate as usize * channels * bytes_per_sample).unwrap_or(0);
    bytes.extend_from_slice(&block.to_le_bytes());
    bytes.extend_from_slice(
        &u16::try_from(channels * bytes_per_sample)
            .unwrap_or(0)
            .to_le_bytes(),
    );
    bytes.extend_from_slice(
        &u16::try_from(bytes_per_sample * 8)
            .unwrap_or(0)
            .to_le_bytes(),
    );
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&u32::try_from(data_length).unwrap_or(0).to_le_bytes());
    for value in samples {
        let scaled = (value * 8_388_608.0)
            .round()
            .clamp(-8_388_608.0, 8_388_607.0);
        if bytes_per_sample == 2 {
            bytes.extend_from_slice(&((scaled / 256.0) as i16).to_le_bytes());
        } else {
            bytes.extend_from_slice(&(scaled as i32).to_le_bytes()[..3]);
        }
    }
    bytes
}

fn raw_bytes(samples: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(samples.len() * 4);
    for value in samples {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

fn ffmpeg(arguments: &[&str]) {
    let status = Command::new(REFERENCE)
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .expect("ffmpeg should run");
    assert!(status.success(), "ffmpeg failed: {arguments:?}");
}

fn loudness_reference(from: &std::path::Path) -> (f64, f64) {
    let output = Command::new(REFERENCE)
        .args([
            "-hide_banner",
            "-nostats",
            "-i",
            &from.display().to_string(),
            "-af",
            "ebur128=peak=true",
            "-f",
            "null",
            "-",
        ])
        .stdin(Stdio::null())
        .output()
        .expect("ffmpeg should run");
    let reported = String::from_utf8_lossy(&output.stderr).into_owned();
    let summary = reported
        .rfind("Summary:")
        .map(|start| reported[start..].to_owned())
        .expect("the filter should print a summary");
    println!("SUMMARY {summary}\nEND");
    (labelled(&summary, "I:"), labelled(&summary, "Peak:"))
}

fn labelled(summary: &str, label: &str) -> f64 {
    summary
        .lines()
        .filter_map(|line| line.trim().strip_prefix(label))
        .filter_map(|value| value.split_whitespace().next())
        .find_map(|value| value.parse::<f64>().ok())
        .expect("the summary should carry the measurement")
}

fn main() {
    std::fs::create_dir_all(OUT).expect("the fixtures directory should build");
    let temp = std::env::temp_dir().join(format!("musetric-golden-{}", std::process::id()));
    std::fs::create_dir_all(&temp).expect("the temp directory should build");

    let decode = decode_tone();
    let source = temp.join("decode.wav");
    write(&source, wav_bytes(&render(&decode, RATE), 3, 2, RATE)).expect("write");
    ffmpeg(&[
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        &source.display().to_string(),
        "-c:a",
        "flac",
        &format!("{OUT}/decode.flac"),
    ]);
    ffmpeg(&[
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        &source.display().to_string(),
        "-f",
        "f32le",
        &format!("{OUT}/decode-flac.pcm"),
    ]);
    let source16 = temp.join("decode16.wav");
    write(&source16, wav_bytes(&render(&decode, RATE), 2, 2, RATE)).expect("write");
    ffmpeg(&[
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        &source16.display().to_string(),
        "-c:a",
        "pcm_s16be",
        &format!("{OUT}/decode.aiff"),
    ]);
    ffmpeg(&[
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        &source16.display().to_string(),
        "-f",
        "f32le",
        &format!("{OUT}/decode-aiff.pcm"),
    ]);
    ffmpeg(&[
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        &source16.display().to_string(),
        "-c:a",
        "alac",
        &format!("{OUT}/decode-alac.m4a"),
    ]);
    ffmpeg(&[
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        &format!("{OUT}/decode-alac.m4a"),
        "-f",
        "f32le",
        &format!("{OUT}/decode-alac.pcm"),
    ]);
    ffmpeg(&[
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        &source16.display().to_string(),
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        &format!("{OUT}/decode-aac.m4a"),
    ]);
    ffmpeg(&[
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        &format!("{OUT}/decode-aac.m4a"),
        "-f",
        "f32le",
        &format!("{OUT}/decode-aac.pcm"),
    ]);
    ffmpeg(&[
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        &source16.display().to_string(),
        "-c:a",
        "vorbis",
        "-strict",
        "-2",
        "-q:a",
        "6",
        &format!("{OUT}/decode-vorbis.ogg"),
    ]);
    ffmpeg(&[
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        &format!("{OUT}/decode-vorbis.ogg"),
        "-f",
        "f32le",
        &format!("{OUT}/decode-vorbis.pcm"),
    ]);
    ffmpeg(&[
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        &source16.display().to_string(),
        "-c:a",
        "opus",
        "-strict",
        "-2",
        &format!("{OUT}/decode-opus.opus"),
    ]);
    ffmpeg(&[
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        &source16.display().to_string(),
        "-ac",
        "1",
        "-c:a",
        "flac",
        &format!("{OUT}/decode-mono.flac"),
    ]);
    ffmpeg(&[
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        &format!("{OUT}/decode-mono.flac"),
        "-ac",
        "2",
        "-f",
        "f32le",
        &format!("{OUT}/decode-mono.pcm"),
    ]);

    let surround: Vec<Vec<Partial>> = vec![
        vec![partial(440.0, 0.6, 0.0)],
        vec![partial(330.0, 0.5, 1.0)],
        vec![partial(523.25, 0.3, 2.0)],
        vec![partial(80.0, 0.2, 0.0)],
        vec![partial(880.0, 0.15, 3.0)],
        vec![partial(987.77, 0.12, 4.0)],
    ];
    let surround_samples = bytes_6ch(&render_channels(&surround, RATE));
    let surround_source = temp.join("surround.wav");
    write(&surround_source, surround_samples).expect("write");
    ffmpeg(&[
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        &surround_source.display().to_string(),
        "-c:a",
        "flac",
        &format!("{OUT}/decode-surround.flac"),
    ]);
    ffmpeg(&[
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        &format!("{OUT}/decode-surround.flac"),
        "-ac",
        "2",
        "-f",
        "f32le",
        &format!("{OUT}/decode-surround.pcm"),
    ]);

    let parity_sources: Vec<(&str, Signal)> = vec![
        (
            "parity-tone",
            Signal {
                left: vec![partial(440.0, 0.3, 0.0), partial(523.25, 0.225, 0.0)],
                right: vec![partial(587.33, 0.4, 1.0)],
                seconds: 2.0,
                gate: None,
            },
        ),
        (
            "parity-chord",
            Signal {
                left: vec![
                    partial(261.63, 0.5, 0.0),
                    partial(329.63, 0.4, 1.0),
                    partial(392.0, 0.3, 2.0),
                    partial(523.25, 0.2, 3.0),
                    partial(659.26, 0.15, 4.0),
                    partial(783.99, 0.1, 5.0),
                ],
                right: vec![
                    partial(261.63, 0.5, 0.0),
                    partial(329.63, 0.4, 1.0),
                    partial(392.0, 0.3, 2.0),
                    partial(523.25, 0.2, 3.0),
                    partial(659.26, 0.15, 4.0),
                    partial(783.99, 0.1, 5.0),
                ],
                seconds: 2.0,
                gate: None,
            },
        ),
        (
            "parity-bursts",
            Signal {
                left: vec![partial(2000.0, 0.9, 0.0), partial(300.0, 0.4, 0.0)],
                right: vec![partial(2000.0, 0.9, 0.0), partial(300.0, 0.4, 0.0)],
                seconds: 2.0,
                gate: Some(|time| if time % 0.5 < 0.05 { 1.0 } else { 0.4 }),
            },
        ),
    ];
    for (name, signal) in &parity_sources {
        let path = temp.join(format!("{name}.wav"));
        write(&path, wav_bytes(&render(signal, RATE), 2, 2, RATE)).expect("write");
        ffmpeg(&[
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            &path.display().to_string(),
            "-c:a",
            "aac",
            "-profile:a",
            "aac_low",
            "-b:a",
            "256k",
            &format!("{OUT}/{name}.m4a"),
        ]);
    }

    let mono_signal = Signal {
        left: vec![partial(440.0, 0.6, 0.0)],
        right: vec![partial(523.25, 0.3, 1.0)],
        seconds: 1.0,
        gate: None,
    };
    let mono_source = temp.join("mono.wav");
    write(
        &mono_source,
        wav_bytes(&render(&mono_signal, RATE), 3, 2, RATE),
    )
    .expect("write");
    ffmpeg(&[
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        &mono_source.display().to_string(),
        "-ac",
        "1",
        "-f",
        "f32le",
        "-c:a",
        "pcm_f32le",
        &format!("{OUT}/mono-power.pcm"),
    ]);
    ffmpeg(&[
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        &mono_source.display().to_string(),
        "-af",
        "pan=mono|c0=0.5*c0+0.5*c1",
        "-f",
        "f32le",
        "-c:a",
        "pcm_f32le",
        &format!("{OUT}/mono-mean.pcm"),
    ]);
    ffmpeg(&[
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        &mono_source.display().to_string(),
        "-af",
        "pan=mono|c0=0.5*c0+0.5*c1",
        "-ar",
        "22050",
        "-f",
        "f32le",
        "-c:a",
        "pcm_f32le",
        &format!("{OUT}/mono-mean-22050.pcm"),
    ]);

    let loudness_signal = Signal {
        left: vec![partial(440.0, 0.3, 0.0), partial(523.25, 0.225, 0.0)],
        right: vec![partial(330.0, 0.25, 1.0), partial(659.26, 0.175, 2.0)],
        seconds: 4.0,
        gate: None,
    };
    let loudness_source = temp.join("loudness.wav");
    write(
        &loudness_source,
        wav_bytes(&render(&loudness_signal, RATE), 2, 2, RATE),
    )
    .expect("write");
    let (integrated, peak) = loudness_reference(&loudness_source);
    println!("LOUDNESS integrated {integrated} peak {peak}");

    let resample_signal = Signal {
        left: vec![partial(440.0, 0.6, 0.0), partial(523.25, 0.45, 1.0)],
        right: vec![partial(330.0, 0.5, 0.0), partial(659.26, 0.35, 2.0)],
        seconds: 2.0,
        gate: None,
    };
    let raw = temp.join("resample.f32");
    write(&raw, raw_bytes(&render(&resample_signal, 44_100))).expect("write");
    ffmpeg(&[
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "f32le",
        "-ar",
        "44100",
        "-ac",
        "2",
        "-i",
        &raw.display().to_string(),
        "-ar",
        "48000",
        "-f",
        "f32le",
        &format!("{OUT}/resample.pcm"),
    ]);

    ffmpeg(&[
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        &format!("{OUT}/tone.mp3"),
        "-f",
        "f32le",
        &format!("{OUT}/tone-mp3.pcm"),
    ]);

    std::fs::remove_dir_all(&temp).ok();
    println!("goldens written");
}

#[expect(
    clippy::cast_precision_loss,
    reason = "the fixture length and time base stay far below the exact range of f32"
)]
fn render_channels(channels: &[Vec<Partial>], rate: u32) -> Vec<f32> {
    let count = rate as usize;
    let mut samples = Vec::with_capacity(count * channels.len());
    for index in 0..count {
        let time = index as f32 / rate as f32;
        for channel in channels {
            samples.push(mix(channel, time));
        }
    }
    samples
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "the sample is rounded and clamped into the target width before the cast"
)]
fn bytes_6ch(samples: &[f32]) -> Vec<u8> {
    let data_length = samples.len() * 2;
    let mut bytes = Vec::with_capacity(data_length + 44);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&u32::try_from(data_length + 36).unwrap_or(0).to_le_bytes());
    bytes.extend_from_slice(b"WAVE");
    bytes.extend_from_slice(b"fmt ");
    bytes.extend_from_slice(&16_u32.to_le_bytes());
    bytes.extend_from_slice(&1_u16.to_le_bytes());
    bytes.extend_from_slice(&6_u16.to_le_bytes());
    bytes.extend_from_slice(&RATE.to_le_bytes());
    let block = u32::try_from(RATE as usize * 6 * 2).unwrap_or(0);
    bytes.extend_from_slice(&block.to_le_bytes());
    bytes.extend_from_slice(&12_u16.to_le_bytes());
    bytes.extend_from_slice(&16_u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&u32::try_from(data_length).unwrap_or(0).to_le_bytes());
    for value in samples {
        bytes.extend_from_slice(
            &(((value * 8_388_608.0)
                .round()
                .clamp(-8_388_608.0, 8_388_607.0)
                / 256.0) as i16)
                .to_le_bytes(),
        );
    }
    bytes
}
