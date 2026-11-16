use std::{fs, time::Instant};

use musetric_wasm_dsp::{decode, decode_window, work_dir};

fn median(mut times: Vec<f64>) -> f64 {
    times.sort_by(f64::total_cmp);
    times[times.len() / 2]
}

fn main() {
    let data = work_dir().join("data");
    for (case, name, extension) in [
        ("flac24-whole", "stem-48k-24.flac", "flac"),
        ("fmp4-aac256-whole", "stem-48k-fmp4.mp4", "mp4"),
    ] {
        let bytes = fs::read(data.join(name)).unwrap();
        let mut times = Vec::new();
        let mut frames = 0;
        for _ in 0..6 {
            let start = Instant::now();
            let (pcm, _) = decode(bytes.clone(), extension, 0).unwrap();
            times.push(start.elapsed().as_secs_f64() * 1000.0);
            frames = pcm.len() / 2;
        }
        times.remove(0);
        println!(
            "{{\"side\":\"native\",\"task\":\"playback\",\"case\":\"{case}\",\"ms\":{:.1},\"frames\":{frames}}}",
            median(times)
        );
    }
    let bytes: &'static [u8] = Box::leak(
        fs::read(data.join("stem-48k-24.flac"))
            .unwrap()
            .into_boxed_slice(),
    );
    let mut times = Vec::new();
    for index in 0..21 {
        let start_ms = 5_000 + index * 9_700;
        let start = Instant::now();
        let window = decode_window(bytes, "flac", start_ms, 2_000).unwrap();
        times.push(start.elapsed().as_secs_f64() * 1000.0);
        assert_eq!(window.len(), 2 * 96_000);
    }
    let max = times.iter().copied().fold(0.0, f64::max);
    println!(
        "{{\"side\":\"native\",\"task\":\"playback\",\"case\":\"flac24-window-2s\",\"ms\":{:.2},\"maxMs\":{max:.2}}}",
        median(times)
    );
}
