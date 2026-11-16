use std::{fs, path::Path, time::Instant};

use musetric_wasm_dsp::{decode, encode_aac, encode_flac, encode_mp3, resample, stretch, work_dir};

const RUNS: usize = 5;

fn median(mut times: Vec<f64>) -> f64 {
    times.sort_by(f64::total_cmp);
    times[times.len() / 2]
}

fn measure<T>(mut run: impl FnMut() -> T) -> (f64, T) {
    let mut kept = run();
    let mut times = Vec::new();
    for _ in 0..RUNS {
        let start = Instant::now();
        kept = run();
        times.push(start.elapsed().as_secs_f64() * 1000.0);
    }
    (median(times), kept)
}

fn write_floats(path: &Path, floats: &[f32]) {
    let bytes: Vec<u8> = floats
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect();
    fs::write(path, bytes).unwrap();
}

fn report(task: &str, case: &str, ms: f64, seconds: f64, extra: &str) {
    println!(
        "{{\"side\":\"native\",\"task\":\"{task}\",\"case\":\"{case}\",\"ms\":{ms:.2},\"realtime\":{:.1}{extra}}}",
        seconds * 1000.0 / ms
    );
}

fn main() {
    let work = work_dir();
    let data = work.join("data");
    let out = work.join("results").join("native");
    fs::create_dir_all(&out).unwrap();
    let files = [
        ("mp3-44k", "song-44k.mp3", "mp3"),
        ("aac-48k", "song-48k.m4a", "m4a"),
        ("flac-48k", "song-48k.flac", "flac"),
        ("wav-48k", "song-48k.wav", "wav"),
        ("vorbis-48k", "song-48k.ogg", "ogg"),
        ("opus-48k", "song-48k.opus", "opus"),
    ];
    for (case, name, extension) in files {
        let bytes = fs::read(data.join(name)).unwrap();
        let (ms, (pcm, rate)) = measure(|| decode(bytes.clone(), extension, 0).unwrap());
        let seconds = pcm.len() as f64 / 2.0 / f64::from(rate);
        report("decode", case, ms, seconds, "");
        write_floats(&out.join(format!("decode-{case}.f32")), &pcm);
    }
    let pcm48 = decode(fs::read(data.join("song-48k.flac")).unwrap(), "flac", 0)
        .unwrap()
        .0;
    let pcm44 = decode(fs::read(data.join("song-44k.flac")).unwrap(), "flac", 0)
        .unwrap()
        .0;
    write_floats(&work.join("results").join("pcm-48k.f32"), &pcm48);
    write_floats(&work.join("results").join("pcm-44k.f32"), &pcm44);
    let seconds48 = pcm48.len() as f64 / 2.0 / 48_000.0;
    let seconds44 = pcm44.len() as f64 / 2.0 / 44_100.0;

    let (ms, resampled) = measure(|| resample(&pcm48, 48_000, 44_100).unwrap());
    report("resample", "48k-to-44k", ms, seconds48, "");
    write_floats(&out.join("resample-48k-to-44k.f32"), &resampled);

    let (ms, flac) = measure(|| encode_flac(&pcm44, 44_100).unwrap());
    report(
        "encode",
        "flac-16",
        ms,
        seconds44,
        &format!(",\"bytes\":{}", flac.len()),
    );
    fs::write(out.join("encode-flac-16.bin"), &flac).unwrap();
    let (ms, aac) = measure(|| encode_aac(&pcm44, 44_100, 192_000).unwrap());
    report(
        "encode",
        "aac-192",
        ms,
        seconds44,
        &format!(",\"bytes\":{}", aac.len()),
    );
    fs::write(out.join("encode-aac-192.bin"), &aac).unwrap();
    let (ms, mp3) = measure(|| encode_mp3(&pcm44, 44_100, 192_000).unwrap());
    report(
        "encode",
        "mp3-192",
        ms,
        seconds44,
        &format!(",\"bytes\":{}", mp3.len()),
    );
    fs::write(out.join("encode-mp3-192.bin"), &mp3).unwrap();

    let (ms, shifted) = measure(|| stretch(&pcm44, 44_100, 2, 100, false).unwrap());
    report("stretch", "pitch+2", ms, seconds44, "");
    write_floats(&out.join("stretch-pitch+2.f32"), &shifted);
    let (ms, slowed) = measure(|| stretch(&pcm44, 44_100, 0, 80, false).unwrap());
    report("stretch", "tempo80", ms, seconds44, "");
    write_floats(&out.join("stretch-tempo80.f32"), &slowed);
    let (ms, formants) = measure(|| stretch(&pcm44, 44_100, 2, 100, true).unwrap());
    report("stretch", "pitch+2-formants", ms, seconds44, "");
    write_floats(&out.join("stretch-pitch+2-formants.f32"), &formants);
    let again = stretch(&pcm44, 44_100, 2, 100, false).unwrap();
    let same = again == shifted;
    println!(
        "{{\"side\":\"native\",\"task\":\"stretch\",\"case\":\"pitch+2-run-twice\",\"identical\":{same}}}"
    );
}
