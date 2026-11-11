use std::{
    collections::{BTreeMap, HashSet},
    io::{self, ErrorKind},
    path::{Path, PathBuf},
};

use musetric_gpu::{ModelFile, has_verified_copy, kept_files};
use musetric_media::Downmix;
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::{Value, json};
use tokio::fs::{DirEntry, ReadDir, read_dir, remove_dir_all, remove_file, try_exists};

use crate::analysis::browser::Failure;

const SEPARATION_PIN: &str = include_str!("../../../ai/src/runtime/vocals/pin.json");
const TRANSCRIPTION_PIN: &str = include_str!("../../../ai/src/runtime/whisper/pin.json");
const CHORDS_PIN: &str = include_str!("../../../ai/src/runtime/chords/pin.json");
const RHYTHM_PIN: &str = include_str!("../../../ai/src/runtime/rhythm/pin.json");
const KEY_PIN: &str = include_str!("../../../ai/src/runtime/key/pin.json");

#[derive(Deserialize)]
pub(crate) struct PinnedFile {
    pub(crate) name: String,
    pub(crate) sha256: String,
    pub(crate) bytes: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelPin {
    pub(crate) repository: String,
    pub(crate) revision: String,
    pub(crate) sample_rate: u32,
    files: BTreeMap<String, PinnedFile>,
}

impl ModelPin {
    pub(crate) fn file(&self, role: &str) -> Result<&PinnedFile, Failure> {
        self.files
            .get(role)
            .ok_or_else(|| Failure::Refused(format!("{} pins no {role} file", self.repository)))
    }

    pub(crate) fn files(&self) -> impl Iterator<Item = &PinnedFile> {
        self.files.values()
    }
}

#[derive(Deserialize)]
pub(crate) struct GraphPin<Graph> {
    #[serde(flatten)]
    pub(crate) model: ModelPin,
    pub(crate) graph: Graph,
}

fn read_pin<Pin: DeserializeOwned>(step: &str, text: &str) -> Result<Pin, String> {
    serde_json::from_str(text).map_err(|error| format!("the {step} pin does not parse: {error}"))
}

pub(crate) struct ModelPins {
    pub(crate) separation: GraphPin<Value>,
    pub(crate) transcription: GraphPin<Value>,
    pub(crate) chords: GraphPin<Value>,
    pub(crate) rhythm: GraphPin<Value>,
    pub(crate) key: GraphPin<Value>,
}

impl ModelPins {
    pub(crate) fn read() -> Result<Self, String> {
        Ok(Self {
            separation: read_pin("separation", SEPARATION_PIN)?,
            transcription: read_pin("transcription", TRANSCRIPTION_PIN)?,
            chords: read_pin("chords", CHORDS_PIN)?,
            rhythm: read_pin("rhythm", RHYTHM_PIN)?,
            key: read_pin("key", KEY_PIN)?,
        })
    }

    fn bundles(&self) -> [(&'static ModelBundle, &ModelPin); 5] {
        [
            (&VOCALS, &self.separation.model),
            (&WHISPER, &self.transcription.model),
            (&BEAT_THIS, &self.rhythm.model),
            (&CHORD_NET, &self.chords.model),
            (&SKEY, &self.key.model),
        ]
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CacheLayout {
    Flat,
    Hub,
}

pub(crate) struct ModelBundle {
    pub(crate) label: &'static str,
    pub(crate) directory: &'static str,
    pub(crate) downmix: Downmix,
    pub(crate) layout: CacheLayout,
}

impl ModelBundle {
    pub(crate) fn root(&self, models_path: &Path) -> PathBuf {
        models_path.join(self.directory)
    }

    fn revisions(&self, pin: &ModelPin, models_path: &Path) -> PathBuf {
        self.root(models_path).join(&pin.repository).join("resolve")
    }

    pub(crate) fn cached(&self, pin: &ModelPin, models_path: &Path) -> Vec<ModelFile> {
        let directory = match self.layout {
            CacheLayout::Flat => self.root(models_path),
            CacheLayout::Hub => self.revisions(pin, models_path).join(&pin.revision),
        };
        pin.files()
            .map(|file| ModelFile {
                label: self.label.to_owned(),
                file: file.name.clone(),
                url: format!(
                    "https://huggingface.co/{}/resolve/{}/{}",
                    pin.repository, pin.revision, file.name
                ),
                sha256: file.sha256.clone(),
                path: directory.join(&file.name),
            })
            .collect()
    }
}

pub(crate) const CHORD_NET: ModelBundle = ModelBundle {
    label: "Chord recognition model",
    directory: "chordmini-onnx",
    layout: CacheLayout::Flat,
    downmix: Downmix::Mean,
};

pub(crate) const BEAT_THIS: ModelBundle = ModelBundle {
    label: "Rhythm analysis model",
    directory: "beat-this-onnx",
    layout: CacheLayout::Flat,
    downmix: Downmix::Mean,
};

pub(crate) const SKEY: ModelBundle = ModelBundle {
    label: "Key detection model",
    directory: "skey-onnx",
    layout: CacheLayout::Flat,
    downmix: Downmix::Power,
};

pub(crate) const WHISPER: ModelBundle = ModelBundle {
    label: "Whisper transcription model",
    directory: "whisper-onnx-hf-cache",
    downmix: Downmix::Power,
    layout: CacheLayout::Hub,
};

const IOS_WHISPER_WINDOWS_PER_BATCH: u32 = 1;

pub(crate) fn whisper_graph(pin: &GraphPin<Value>) -> Value {
    let mut graph = pin.graph.clone();
    if cfg!(target_os = "ios")
        && let Some(fields) = graph.as_object_mut()
    {
        fields.insert(
            "windowsPerBatch".to_owned(),
            json!(IOS_WHISPER_WINDOWS_PER_BATCH),
        );
    }
    graph
}

pub(crate) const VOCALS: ModelBundle = ModelBundle {
    label: "Stem separation model",
    directory: "mel-band-roformer-duality-kara2-student-onnx",
    downmix: Downmix::Power,
    layout: CacheLayout::Flat,
};

const REVISION_LENGTH: usize = 40;

pub(crate) struct DownloadSize {
    pub(crate) total_bytes: u64,
    pub(crate) missing_bytes: u64,
}

pub(crate) async fn download_size(models_path: &Path, pins: &ModelPins) -> DownloadSize {
    let mut size = DownloadSize {
        total_bytes: 0,
        missing_bytes: 0,
    };
    for (bundle, pin) in pins.bundles() {
        for (model, file) in bundle.cached(pin, models_path).iter().zip(pin.files()) {
            size.total_bytes += file.bytes;
            if !has_verified_copy(model).await {
                size.missing_bytes += file.bytes;
            }
        }
    }
    size
}

pub(crate) async fn remove_unpinned(models_path: &Path, pins: &ModelPins) -> Vec<PathBuf> {
    let mut removed = Vec::new();
    for (bundle, pin) in pins.bundles() {
        let models = bundle.cached(pin, models_path);
        let Some(directory) = models.first().and_then(|model| model.path.parent()) else {
            continue;
        };
        if bundle.layout == CacheLayout::Hub {
            remove_other_revisions(
                &bundle.revisions(pin, models_path),
                &pin.revision,
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

    use super::{CHORD_NET, ModelPins, WHISPER, remove_unpinned};
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
        let pins = ModelPins::read().expect("the pins should parse");
        let chords = CHORD_NET.cached(&pins.chords.model, &models);
        let flat = chords[0]
            .path
            .parent()
            .expect("a pin has a folder")
            .to_owned();
        let whisper = WHISPER.cached(&pins.transcription.model, &models);
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

        let mut removed = remove_unpinned(&models, &pins).await;
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
