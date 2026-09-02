use std::path::{Path, PathBuf};

use musetric_gpu::ModelFile;
use musetric_media::Downmix;

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
    pub(crate) files: &'static [(&'static str, &'static str)],
}

impl ModelBundle {
    pub(crate) fn root(&self, models_path: &Path) -> PathBuf {
        models_path.join(self.directory)
    }

    pub(crate) fn cached(&self, models_path: &Path) -> Vec<ModelFile> {
        let directory = match self.layout {
            CacheLayout::Flat => self.root(models_path),
            CacheLayout::Hub => self
                .root(models_path)
                .join(self.model_id)
                .join("resolve")
                .join(self.revision),
        };
        self.files
            .iter()
            .map(|(file, sha256)| ModelFile {
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

pub(crate) const CHORD_NET_MODEL: &str = "chordnet.onnx";
pub(crate) const CHORD_NET_PLAN: &str = "cqt-plan.bin";
pub(crate) const CHORD_NET_PLAN_MANIFEST: &str = "cqt-plan.manifest.json";

pub(crate) const CHORD_NET: ModelBundle = ModelBundle {
    label: "Chord recognition model",
    model_id: "musetric/chordmini-onnx",
    revision: "fbd620e6a7617bbc82795b1f0c828a7721c213f4",
    directory: "chordmini-onnx",
    sample_rate: 22050,
    layout: CacheLayout::Flat,
    downmix: Downmix::Mean,
    files: &[
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
    ],
};

pub(crate) const BEAT_THIS_MODEL: &str = "beat_this.onnx";
pub(crate) const BEAT_THIS_FILTERBANK: &str = "mel-filterbank.bin";

pub(crate) const BEAT_THIS: ModelBundle = ModelBundle {
    label: "Rhythm analysis model",
    model_id: "musetric/beat-this-onnx",
    revision: "45ba973e6c1fbee08a8a75b485e1c5adf45d2bc4",
    directory: "beat-this-onnx",
    sample_rate: 22050,
    layout: CacheLayout::Flat,
    downmix: Downmix::Mean,
    files: &[
        (
            "config.json",
            "56cc961ddc588c57787c20c01ec6ab483b23af1049e65bd33d599a81803acd69",
        ),
        (
            BEAT_THIS_MODEL,
            "3472a3957f25f4c3a2d68b46ee4b784e065a8ebd46132796c1a6bdd817229253",
        ),
        (
            BEAT_THIS_FILTERBANK,
            "1ee975d96f44ccf2c3bfe37825c1c1f0b089f5703c7a12a84b1f0a3bce004533",
        ),
    ],
};

pub(crate) const SKEY_MODEL: &str = "skey.onnx";

pub(crate) const SKEY: ModelBundle = ModelBundle {
    label: "Key detection model",
    model_id: "musetric/skey-onnx",
    revision: "9d90d2a9ff6679df1d64000f4fa750643f247643",
    directory: "skey-onnx",
    sample_rate: 22050,
    layout: CacheLayout::Flat,
    downmix: Downmix::Ffmpeg,
    files: &[
        (
            "config.json",
            "20be1e139e1b05dea4bae2e2dde717d593c10c30bb38b300aeedc6693be88a52",
        ),
        (
            SKEY_MODEL,
            "5113c1378c1007c8559fcb767593366ba9794397b060535eb80a113db50530fc",
        ),
    ],
};

pub(crate) const WHISPER: ModelBundle = ModelBundle {
    label: "Whisper transcription model",
    model_id: "musetric/whisper-large-v3-turbo-onnx",
    revision: "da27c0c3e917574b5541f71251abfd2c1aabb3a1",
    directory: "whisper-onnx-hf-cache",
    sample_rate: 16000,
    downmix: Downmix::Ffmpeg,
    layout: CacheLayout::Hub,
    files: &[
        (
            "config.json",
            "3895aac9c18e541502ded9bf0f4c31cbe25a3387ef88ffdc85214e43acc0ca57",
        ),
        (
            "generation_config.json",
            "0392ccf797bca2bff1600477ed6fb71d367b428f3da626c6d3c8dbd82c58ae44",
        ),
        (
            "preprocessor_config.json",
            "7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711",
        ),
        (
            "tokenizer.json",
            "b3c8202bbf06d8ee4232c5984baa563784ac4737e2e7fdc42fa180200d3cfcdb",
        ),
        (
            "tokenizer_config.json",
            "844b642c73a91359722f47b35705f7174686df33d252695d8572cf9ac03a6389",
        ),
        (
            "special_tokens_map.json",
            "baea4ea09372eb4fca86b4e4346139fd73cb807d5087e9de0948e971739c3e74",
        ),
        (
            "added_tokens.json",
            "3c51f66c4c21f9e126970078f11ae77a78c74aee8df606ee9daba86e467108e0",
        ),
        (
            "vocab.json",
            "e2aa043ef015641d363d8288e7c241c85e36a5c761fb303598e0710233344387",
        ),
        (
            "merges.txt",
            "2df2990a395e35e8dfbc7511e08c12d56018d8d04691e0133e5d63b21e154dc6",
        ),
        (
            "normalizer.json",
            "bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd",
        ),
        (
            "encoder_model_q4.onnx",
            "d27943f0f3ee4fdfc33241a64d68fffd40ce0f2344ee21f73d37abac9ebd1a43",
        ),
        (
            "decoder_model_merged_fp16.onnx",
            "6497641a50badd9fd90f58907fe74ad43048a874b8288e2039f26ce01a15ef3e",
        ),
    ],
};
