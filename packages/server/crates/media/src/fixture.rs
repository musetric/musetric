use std::{
    fs::{create_dir_all, remove_dir_all},
    path::PathBuf,
    process::id,
    sync::atomic::{AtomicUsize, Ordering},
};

use crate::{Tools, decode::SymphoniaPcm, run::run};

static TAKEN: AtomicUsize = AtomicUsize::new(0);

pub(crate) struct Signal<'signal> {
    pub(crate) name: &'signal str,
    pub(crate) expression: &'signal str,
    pub(crate) seconds: f64,
    pub(crate) sample_rate: u32,
}

pub(crate) struct Fixture {
    directory: PathBuf,
    pub(crate) tools: Tools,
    pub(crate) pcm: SymphoniaPcm,
}

impl Fixture {
    pub(crate) fn create() -> Self {
        let taken = TAKEN.fetch_add(1, Ordering::Relaxed);
        let directory = std::env::temp_dir().join(format!("musetric-media-{}-{taken}", id()));
        create_dir_all(&directory).expect("the fixture directory should be built");
        Self {
            directory,
            tools: Tools {
                ffmpeg: bundled("ffmpeg"),
            },
            pcm: SymphoniaPcm,
        }
    }

    pub(crate) fn join(&self, name: &str) -> PathBuf {
        self.directory.join(name)
    }

    pub(crate) async fn write_wav(&self, signal: &Signal<'_>) -> PathBuf {
        self.write(signal, &["-c:a".to_owned(), "pcm_s16le".to_owned()])
            .await
    }

    pub(crate) async fn write_flac(&self, signal: &Signal<'_>) -> PathBuf {
        self.write(signal, &["-c:a".to_owned(), "flac".to_owned()])
            .await
    }

    pub(crate) async fn write_as(&self, signal: &Signal<'_>, format: &[&str]) -> PathBuf {
        let arguments = format
            .iter()
            .map(|part| (*part).to_owned())
            .collect::<Vec<_>>();
        self.write(signal, &arguments).await
    }

    pub(crate) fn asset(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("fixtures")
            .join(name)
    }

    pub(crate) async fn write_raw(&self, signal: &Signal<'_>) -> PathBuf {
        self.write(signal, &["-f".to_owned(), "f32le".to_owned()])
            .await
    }

    async fn write(&self, signal: &Signal<'_>, format: &[String]) -> PathBuf {
        let to = self.join(signal.name);
        let source = format!(
            "aevalsrc=exprs={}:s={}:d={}",
            signal.expression, signal.sample_rate, signal.seconds
        );
        let mut arguments = vec![
            "-hide_banner".to_owned(),
            "-loglevel".to_owned(),
            "error".to_owned(),
            "-y".to_owned(),
            "-f".to_owned(),
            "lavfi".to_owned(),
            "-i".to_owned(),
            source,
        ];
        arguments.extend_from_slice(format);
        arguments.push(to.display().to_string());
        run(&self.tools.ffmpeg, &arguments)
            .await
            .expect("the fixture should be written");
        to
    }
}

pub(crate) fn read_floats(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(size_of::<f32>())
        .filter_map(|value| <[u8; 4]>::try_from(value).ok())
        .map(f32::from_le_bytes)
        .collect()
}

pub(crate) fn energy(values: &[f32]) -> f64 {
    values.iter().map(|value| f64::from(*value).powi(2)).sum()
}

pub(crate) fn level(measured: &[f32], expected: &[f32]) -> f64 {
    (energy(measured) / energy(expected)).sqrt()
}

pub(crate) fn correlation(left: &[f32], right: &[f32]) -> f64 {
    let mut product = 0.0_f64;
    let mut left_energy = 0.0_f64;
    let mut right_energy = 0.0_f64;
    for (first, second) in left.iter().zip(right) {
        product += f64::from(*first) * f64::from(*second);
        left_energy += f64::from(*first) * f64::from(*first);
        right_energy += f64::from(*second) * f64::from(*second);
    }
    product / (left_energy.sqrt() * right_energy.sqrt())
}

pub(crate) fn worst_difference(measured: &[f32], expected: &[f32]) -> f32 {
    measured
        .iter()
        .zip(expected)
        .map(|(ours, theirs)| (ours - theirs).abs())
        .fold(0.0_f32, f32::max)
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = remove_dir_all(&self.directory);
    }
}

fn bundled(name: &str) -> PathBuf {
    let platform = match std::env::consts::OS {
        "windows" => "win32",
        "macos" => "darwin",
        other => other,
    };
    let architecture = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => other,
    };
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../ffmpeg/resources")
        .join(format!("{platform}-{architecture}"))
        .join(format!("{name}{}", std::env::consts::EXE_SUFFIX))
}
