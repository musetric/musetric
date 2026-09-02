use std::path::Path;

use musetric_gpu::ModelFile;

const MODEL_ID: &str = "musetric/chordmini-onnx";
const REVISION: &str = "fbd620e6a7617bbc82795b1f0c828a7721c213f4";
const CACHE_DIRECTORY: &str = "chordmini-onnx";

pub(crate) const CHORD_NET_LABEL: &str = "Chord recognition model";
pub(crate) const CHORD_NET_SAMPLE_RATE: u32 = 22050;
pub(crate) const CHORD_NET_MODEL: &str = "chordnet.onnx";
pub(crate) const CHORD_NET_PLAN: &str = "cqt-plan.bin";
pub(crate) const CHORD_NET_PLAN_MANIFEST: &str = "cqt-plan.manifest.json";

const CHORD_NET_FILES: [(&str, &str); 4] = [
    (
        "config.json",
        "1f26c11ebea51ec08f12e813eb213a729fa0ecc407ac7632dfdc7bad67e65aa4",
    ),
    (
        CHORD_NET_MODEL,
        "9a6570bf611cdc3f2c36286307af46fb94927fe7f6a2bc22a87c0ebf5f6c082e",
    ),
    (
        CHORD_NET_PLAN,
        "c31f0a6fd2d582d753be6628b5daecdee58acba53cba93b2bc2b5c75dee2ba48",
    ),
    (
        CHORD_NET_PLAN_MANIFEST,
        "522b178e4f6e8ae5b6bf63b8e2f1a615fe2398592e27f7d9e3e219810081019f",
    ),
];

pub(crate) fn chord_net_files(models_path: &Path) -> Vec<ModelFile> {
    let directory = models_path.join(CACHE_DIRECTORY);
    CHORD_NET_FILES
        .iter()
        .map(|(file, sha256)| ModelFile {
            label: CHORD_NET_LABEL.to_owned(),
            file: (*file).to_owned(),
            url: format!("https://huggingface.co/{MODEL_ID}/resolve/{REVISION}/{file}"),
            sha256: (*sha256).to_owned(),
            path: directory.join(file),
        })
        .collect()
}
