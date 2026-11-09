use std::{
    collections::HashSet,
    io::{self, ErrorKind},
    path::{Path, PathBuf},
};

use musetric_gpu::{ModelFile, has_verified_copy, kept_files};
use musetric_media::Downmix;
use serde_json::{Value, json};
use tokio::fs::{DirEntry, ReadDir, read_dir, remove_dir_all, remove_file, try_exists};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CacheLayout {
    Flat,
    Hub,
}

pub(crate) struct ModelBundle {
    pub(crate) label: &'static str,
    pub(crate) model_id: &'static str,
    pub(crate) revision: &'static str,
    pub(crate) directory: &'static str,
    pub(crate) sample_rate: u32,
    pub(crate) downmix: Downmix,
    pub(crate) layout: CacheLayout,
    pub(crate) files: &'static [(&'static str, &'static str, u64)],
}

impl ModelBundle {
    pub(crate) fn root(&self, models_path: &Path) -> PathBuf {
        models_path.join(self.directory)
    }

    fn revisions(&self, models_path: &Path) -> PathBuf {
        self.root(models_path).join(self.model_id).join("resolve")
    }

    pub(crate) fn cached(&self, models_path: &Path) -> Vec<ModelFile> {
        let directory = match self.layout {
            CacheLayout::Flat => self.root(models_path),
            CacheLayout::Hub => self.revisions(models_path).join(self.revision),
        };
        self.files
            .iter()
            .map(|(file, sha256, _)| ModelFile {
                label: self.label.to_owned(),
                file: (*file).to_owned(),
                url: format!(
                    "https://huggingface.co/{}/resolve/{}/{file}",
                    self.model_id, self.revision
                ),
                sha256: (*sha256).to_owned(),
                path: directory.join(file),
            })
            .collect()
    }
}

pub(crate) struct ChunkGeometry {
    pub(crate) n_fft: u32,
    pub(crate) hop: u32,
    pub(crate) frames: u32,
    pub(crate) channels: u32,
    pub(crate) chunk_samples: u32,
}

const fn geometry(n_fft: u32, hop: u32, frames: u32, channels: u32) -> ChunkGeometry {
    ChunkGeometry {
        n_fft,
        hop,
        frames,
        channels,
        chunk_samples: hop * (frames - 1),
    }
}

impl ChunkGeometry {
    fn fields(&self) -> Value {
        json!({
            "nFft": self.n_fft,
            "hop": self.hop,
            "frames": self.frames,
            "channels": self.channels,
            "chunkSamples": self.chunk_samples,
        })
    }
}

fn merge(mut base: Value, extra: Value) -> Value {
    let (Some(target), Value::Object(source)) = (base.as_object_mut(), extra) else {
        return base;
    };
    target.extend(source);
    base
}

pub(crate) const CHORD_NET_MODEL: &str = "chordnet.onnx";
pub(crate) const CHORD_NET_PLAN: &str = "cqt-plan.bin";
pub(crate) const CHORD_NET_PLAN_MANIFEST: &str = "cqt-plan.manifest.json";

pub(crate) const CHORD_NET: ModelBundle = ModelBundle {
    label: "Chord recognition model",
    model_id: "musetric/chordmini-onnx",
    revision: "8ab85fc0f61439900cd07ac21257a43eac57075c",
    directory: "chordmini-onnx",
    sample_rate: 22050,
    layout: CacheLayout::Flat,
    downmix: Downmix::Mean,
    files: &[
        (
            "config.json",
            "1f26c11ebea51ec08f12e813eb213a729fa0ecc407ac7632dfdc7bad67e65aa4",
            3009,
        ),
        (
            CHORD_NET_MODEL,
            "1faee8e1cf168300afe0f47517e76836ac200c3841b0fb430fad7dfea5ad6394",
            17_080_550,
        ),
        (
            CHORD_NET_PLAN,
            "c31f0a6fd2d582d753be6628b5daecdee58acba53cba93b2bc2b5c75dee2ba48",
            23896,
        ),
        (
            CHORD_NET_PLAN_MANIFEST,
            "522b178e4f6e8ae5b6bf63b8e2f1a615fe2398592e27f7d9e3e219810081019f",
            1721,
        ),
    ],
};

pub(crate) fn chord_net_graph() -> Value {
    json!({
        "inputName": "features",
        "outputName": "logits",
        "frameDuration": 2048.0 / 22050.0,
        "sequenceLength": 108,
        "inputBins": 144,
        "chordCount": 170,
        "windowsPerRun": 16,
    })
}

pub(crate) const BEAT_THIS_MODEL: &str = "beat_this.onnx";
pub(crate) const BEAT_THIS_FILTERBANK: &str = "mel-filterbank.bin";

pub(crate) const BEAT_THIS: ModelBundle = ModelBundle {
    label: "Rhythm analysis model",
    model_id: "musetric/beat-this-onnx",
    revision: "25308706dda545c0d5950065bb0604ad71bcf1f5",
    directory: "beat-this-onnx",
    sample_rate: 22050,
    layout: CacheLayout::Flat,
    downmix: Downmix::Mean,
    files: &[
        (
            "config.json",
            "966f271e9a44c8f1b9e438622b34165ecdf6df9adedc8a9c0a6f7fd9d3458cc2",
            1012,
        ),
        (
            BEAT_THIS_MODEL,
            "1337dc6c21257ed6b803418efc320df42b5d8eb296ef16648ef60457cd4b9e55",
            190_649_026,
        ),
        (
            BEAT_THIS_FILTERBANK,
            "1ee975d96f44ccf2c3bfe37825c1c1f0b089f5703c7a12a84b1f0a3bce004533",
            262_656,
        ),
    ],
};

pub(crate) fn beat_this_graph() -> Value {
    json!({
        "inputName": "spect",
        "beatOutputName": "beat",
        "downbeatOutputName": "downbeat",
        "nFft": 1024,
        "hopLength": 441,
        "fps": 50,
        "melBins": 128,
        "logMultiplier": 1000,
        "chunkSize": 1500,
        "borderSize": 6,
    })
}

pub(crate) const SKEY_MODEL: &str = "skey.onnx";

pub(crate) const SKEY: ModelBundle = ModelBundle {
    label: "Key detection model",
    model_id: "musetric/skey-onnx",
    revision: "9d90d2a9ff6679df1d64000f4fa750643f247643",
    directory: "skey-onnx",
    sample_rate: 22050,
    layout: CacheLayout::Flat,
    downmix: Downmix::Power,
    files: &[
        (
            "config.json",
            "20be1e139e1b05dea4bae2e2dde717d593c10c30bb38b300aeedc6693be88a52",
            712,
        ),
        (
            SKEY_MODEL,
            "5113c1378c1007c8559fcb767593366ba9794397b060535eb80a113db50530fc",
            338_482,
        ),
    ],
};

pub(crate) fn skey_graph() -> Value {
    json!({
        "inputName": "audio",
        "outputName": "probs",
    })
}

pub(crate) const WHISPER: ModelBundle = ModelBundle {
    label: "Whisper transcription model",
    model_id: "musetric/whisper-large-v3-turbo-onnx",
    revision: "2c3af36696f93c4989ecfe8da4b0f525bd86c9bb",
    directory: "whisper-onnx-hf-cache",
    sample_rate: 16000,
    downmix: Downmix::Power,
    layout: CacheLayout::Hub,
    files: &[
        (
            "config.json",
            "3895aac9c18e541502ded9bf0f4c31cbe25a3387ef88ffdc85214e43acc0ca57",
            1223,
        ),
        (
            "generation_config.json",
            "db262b08585e6c86efb23ac22c1ea49d577f66d82649063b0761a1513c01f5a2",
            3794,
        ),
        (
            "preprocessor_config.json",
            "7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711",
            340,
        ),
        (
            "tokenizer.json",
            "b3c8202bbf06d8ee4232c5984baa563784ac4737e2e7fdc42fa180200d3cfcdb",
            2_480_645,
        ),
        (
            "tokenizer_config.json",
            "844b642c73a91359722f47b35705f7174686df33d252695d8572cf9ac03a6389",
            282_843,
        ),
        (
            "special_tokens_map.json",
            "baea4ea09372eb4fca86b4e4346139fd73cb807d5087e9de0948e971739c3e74",
            2186,
        ),
        (
            "added_tokens.json",
            "3c51f66c4c21f9e126970078f11ae77a78c74aee8df606ee9daba86e467108e0",
            34648,
        ),
        (
            "vocab.json",
            "e2aa043ef015641d363d8288e7c241c85e36a5c761fb303598e0710233344387",
            1_036_558,
        ),
        (
            "merges.txt",
            "2df2990a395e35e8dfbc7511e08c12d56018d8d04691e0133e5d63b21e154dc6",
            493_869,
        ),
        (
            "normalizer.json",
            "bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd",
            52666,
        ),
        (
            "encoder_model_q4.onnx",
            "8814e622cee0736d725a5ad587e24909fe3cefefc91bf3f125c513387e907a52",
            627_006,
        ),
        (
            "encoder_model_q4.onnx_data",
            "565aec56b45d4247ad729724eee548e680b97aa3124f809bcf601b1596c2f8d6",
            432_189_440,
        ),
        (
            "decoder_model_merged_fp16.onnx",
            "933a4f8e4358414a281750448e20f2249b3981880b9bfeb5327ca18a71638ee9",
            159_565,
        ),
        (
            "decoder_model_merged_fp16.onnx_data",
            "7835ed241ab19116dae6faf12c173d6f3f0c6bfa230cbe6b60b13085eaaf5651",
            317_593_600,
        ),
        (
            "cross_kv_fp16.onnx",
            "86d4ad47d781ae6fa8c08a55dbbaa8e5b8dc8adb5cf0b17f2d4aa59d24e21b7d",
            4790,
        ),
        (
            "cross_kv_fp16.onnx_data",
            "f7e1cc8c070895800ecca27e1fcca0dbed0bd94623abbcc89c84de2dbd812ddd",
            26_224_640,
        ),
    ],
};

#[cfg(target_os = "ios")]
const WHISPER_WINDOWS_PER_BATCH: u32 = 1;
#[cfg(not(target_os = "ios"))]
const WHISPER_WINDOWS_PER_BATCH: u32 = 4;

pub(crate) fn whisper_graph() -> Value {
    json!({
        "windowsPerBatch": WHISPER_WINDOWS_PER_BATCH,
    })
}

pub(crate) const VOCALS_MODEL: &str = "duality_kara2_student_core_t1100.onnx";
pub(crate) const VOCALS_MODEL_DATA: &str = "duality_kara2_student_core_t1100.onnx.data";

pub(crate) const VOCALS: ModelBundle = ModelBundle {
    label: "Stem separation model",
    model_id: "musetric/mel-band-roformer-duality-kara2-student-onnx",
    revision: "48a53200678a45f88e21dc1af957f1e4b55ba5ae",
    directory: "mel-band-roformer-duality-kara2-student-onnx",
    sample_rate: 44100,
    downmix: Downmix::Power,
    layout: CacheLayout::Flat,
    files: &[
        (
            VOCALS_MODEL,
            "86a884e0225233a7d77f88e60d9a7e2febdb0d386d19ddc9476fcf51ed858228",
            6_230_015,
        ),
        (
            VOCALS_MODEL_DATA,
            "176673d2446d8578976dd1a17ebca5fa0651dd23446967ff44fad5bf22c45d5c",
            235_400_588,
        ),
    ],
};

pub(crate) const VOCALS_GEOMETRY: ChunkGeometry = geometry(2048, 441, 1100, 2);
pub(crate) const VOCALS_MASKS: u32 = 2;

pub(crate) fn vocals_graph() -> Value {
    merge(
        VOCALS_GEOMETRY.fields(),
        json!({
            "inputName": "stft_repr",
            "outputName": "masks",
            "masks": VOCALS_MASKS,
            "minStorageBuffersPerShaderStage": 9,
        }),
    )
}

const BUNDLES: [&ModelBundle; 5] = [&VOCALS, &WHISPER, &BEAT_THIS, &CHORD_NET, &SKEY];
const REVISION_LENGTH: usize = 40;

pub(crate) struct DownloadSize {
    pub(crate) total_bytes: u64,
    pub(crate) missing_bytes: u64,
}

pub(crate) async fn download_size(models_path: &Path) -> DownloadSize {
    let mut size = DownloadSize {
        total_bytes: 0,
        missing_bytes: 0,
    };
    for bundle in BUNDLES {
        for (model, (_, _, bytes)) in bundle.cached(models_path).iter().zip(bundle.files) {
            size.total_bytes += bytes;
            if !has_verified_copy(model).await {
                size.missing_bytes += bytes;
            }
        }
    }
    size
}

pub(crate) async fn remove_unpinned(models_path: &Path) -> Vec<PathBuf> {
    let mut removed = Vec::new();
    for bundle in BUNDLES {
        let models = bundle.cached(models_path);
        let Some(directory) = models.first().and_then(|model| model.path.parent()) else {
            continue;
        };
        if bundle.layout == CacheLayout::Hub {
            remove_other_revisions(
                &bundle.revisions(models_path),
                bundle.revision,
                &mut removed,
            )
            .await;
        }
        let kept = read_kept_names(&models).await;
        remove_files_but(directory, &kept, &mut removed).await;
    }
    removed
}

fn folded_name(path: &Path) -> Option<String> {
    path.file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
}

async fn read_kept_names(models: &[ModelFile]) -> HashSet<String> {
    let mut kept = HashSet::new();
    for model in models {
        let [file, manifest, part] = kept_files(model);
        let finished = try_exists(&file).await.unwrap_or(true);
        let paths = [Some(file), Some(manifest), (!finished).then_some(part)];
        kept.extend(paths.iter().flatten().filter_map(|path| folded_name(path)));
    }
    kept
}

fn is_revision(name: &str) -> bool {
    name.len() == REVISION_LENGTH && name.bytes().all(|byte| byte.is_ascii_hexdigit())
}

async fn remove_other_revisions(revisions: &Path, pinned: &str, removed: &mut Vec<PathBuf>) {
    let Some(mut entries) = open_directory(revisions).await else {
        return;
    };
    while let Some(entry) = read_entry(&mut entries, revisions).await {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_lowercase();
        let folder = entry.file_type().await.is_ok_and(|kind| kind.is_dir());
        if !folder || !is_revision(&name) || name == pinned.to_lowercase() {
            continue;
        }
        report_removal(remove_dir_all(&path).await, path, removed);
    }
}

async fn remove_files_but(directory: &Path, kept: &HashSet<String>, removed: &mut Vec<PathBuf>) {
    let Some(mut entries) = open_directory(directory).await else {
        return;
    };
    while let Some(entry) = read_entry(&mut entries, directory).await {
        let path = entry.path();
        let file = entry.file_type().await.is_ok_and(|kind| kind.is_file());
        if !file || folded_name(&path).is_none_or(|name| kept.contains(&name)) {
            continue;
        }
        report_removal(remove_file(&path).await, path, removed);
    }
}

fn report_removal(outcome: io::Result<()>, path: PathBuf, removed: &mut Vec<PathBuf>) {
    match outcome {
        Ok(()) => {
            log::info!("removed {}, which no model pin names", path.display());
            removed.push(path);
        }
        Err(error) => log::warn!("could not remove {}: {error}", path.display()),
    }
}

async fn open_directory(directory: &Path) -> Option<ReadDir> {
    match read_dir(directory).await {
        Ok(entries) => Some(entries),
        Err(error) if error.kind() == ErrorKind::NotFound => None,
        Err(error) => {
            log::warn!("could not read {}: {error}", directory.display());
            None
        }
    }
}

async fn read_entry(entries: &mut ReadDir, directory: &Path) -> Option<DirEntry> {
    match entries.next_entry().await {
        Ok(entry) => entry,
        Err(error) => {
            log::warn!("could not read {}: {error}", directory.display());
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs::{create_dir_all, write},
        path::Path,
    };

    use super::{CHORD_NET, WHISPER, remove_unpinned};
    use crate::test_workspace::Workspace;

    fn put(path: &Path) {
        let directory = path.parent().expect("a file should have a folder");
        create_dir_all(directory).expect("the folder should be created");
        write(path, "bytes").expect("the file should be written");
    }

    #[tokio::test]
    async fn removes_only_the_files_no_pin_names() {
        let workspace = Workspace::new();
        let models = workspace.models_path();
        let chords = CHORD_NET.cached(&models);
        let flat = chords[0]
            .path
            .parent()
            .expect("a pin has a folder")
            .to_owned();
        let whisper = WHISPER.cached(&models);
        let revision = whisper[0]
            .path
            .parent()
            .expect("a pin has a folder")
            .to_owned();
        let revisions = revision
            .parent()
            .expect("a revision has a folder")
            .to_owned();
        let old_revision = revisions.join("0".repeat(40));
        let kept = [
            chords[0].path.clone(),
            flat.join(format!("{}.verified", chords[0].file)),
            flat.join(format!("{}.part", chords[1].file)),
            flat.join(chords[2].file.to_uppercase()),
            flat.join("folder").join("file"),
            whisper[0].path.clone(),
            revisions.join("not-a-revision").join("file"),
            models.join("hub").join("checkpoints").join("model.pth"),
        ];
        let stale = [
            flat.join("chordnet-old.onnx"),
            flat.join("chordnet-old.onnx.verified"),
            flat.join(format!("{}.part", chords[0].file)),
            revision.join("stale.json"),
            old_revision.join("config.json"),
        ];
        for path in kept.iter().chain(&stale) {
            put(path);
        }

        let mut removed = remove_unpinned(&models).await;
        removed.sort();

        let mut expected = vec![
            flat.join("chordnet-old.onnx"),
            flat.join("chordnet-old.onnx.verified"),
            flat.join(format!("{}.part", chords[0].file)),
            revision.join("stale.json"),
            old_revision.clone(),
        ];
        expected.sort();
        assert_eq!(removed, expected);
        assert!(kept.iter().all(|path| path.exists()));
        assert!(!old_revision.exists());
    }
}
