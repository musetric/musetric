use std::path::{Path, PathBuf};

use musetric_gpu::{ModelFile, has_verified_copy};
use musetric_media::Downmix;
use serde_json::{Value, json};

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
    revision: "086162411b8c4772774392be195e5c6f065d67ad",
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
            "cfe7703434ebd1c28ba2ded6601581ab41d8f7d1b40f285110445460e1b11154",
            17_080_918,
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
    revision: "a076df6f20345e133a73b6d2068b68b60e48fafb",
    directory: "beat-this-onnx",
    sample_rate: 22050,
    layout: CacheLayout::Flat,
    downmix: Downmix::Mean,
    files: &[
        (
            "config.json",
            "46e93c11d7afb78e3eba72cac26e1aced47b9b6558379f928c19b0cf95c9af1d",
            1008,
        ),
        (
            BEAT_THIS_MODEL,
            "d6b41a44dbf555e90593f60dc86aea3689e1f5db427956e4c9036c8dfde970e8",
            120_259_561,
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
        "chunkSize": 513,
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
    revision: "84ab6b4473ab12b4df1c3e588a3e6af94338d26d",
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
            "0392ccf797bca2bff1600477ed6fb71d367b428f3da626c6d3c8dbd82c58ae44",
            3797,
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
            "d27943f0f3ee4fdfc33241a64d68fffd40ce0f2344ee21f73d37abac9ebd1a43",
            432_766_809,
        ),
        (
            "decoder_model_merged_fp16.onnx",
            "0f64a6ee464ae44c24b41e312e6c206d29df5d9e9f46162cd3d6e14bd1e770cd",
            344_323_830,
        ),
    ],
};

pub(crate) fn whisper_graph() -> Value {
    json!({
        "dtype": {
            "encoder_model": "q4",
            "decoder_model_merged": "fp16",
        },
    })
}

pub(crate) const VOCALS_MODEL: &str = "syhft_core_t1100.onnx";
pub(crate) const VOCALS_MODEL_DATA: &str = "syhft_core_t1100.onnx.data";

pub(crate) const VOCALS: ModelBundle = ModelBundle {
    label: "Vocals separation model",
    model_id: "musetric/vocal-separation-roformer-onnx",
    revision: "4720922b290b256f80228dbf5b48b592620e70f7",
    directory: "vocal-separation-roformer-onnx",
    sample_rate: 44100,
    downmix: Downmix::Power,
    layout: CacheLayout::Flat,
    files: &[
        (
            VOCALS_MODEL,
            "e6da40047d63ce9129c53d9c9f50b019ffae83de414e05b2800ab67fce13e374",
            8_446_324,
        ),
        (
            VOCALS_MODEL_DATA,
            "648db04fce69e556bc1fb08486ffd7f7ac50d370b1c6026e42ffea9cd621a7ed",
            741_190_540,
        ),
    ],
};

pub(crate) const VOCALS_GEOMETRY: ChunkGeometry = geometry(2048, 441, 1100, 2);

pub(crate) fn vocals_graph() -> Value {
    merge(
        VOCALS_GEOMETRY.fields(),
        json!({
            "inputName": "stft_repr",
            "outputName": "masks",
            "minStorageBuffersPerShaderStage": 9,
        }),
    )
}

pub(crate) const LEAD_BACKING_MODEL: &str = "kara2.onnx";

pub(crate) const LEAD_BACKING: ModelBundle = ModelBundle {
    label: "Lead/backing separation model",
    model_id: "musetric/uvr-mdxnet-kara2-onnx",
    revision: "8f6d5fef650f7cb2dbc55b1abf5460b6fcb8f75a",
    directory: "uvr-mdxnet-kara2-onnx",
    sample_rate: 44100,
    downmix: Downmix::Power,
    layout: CacheLayout::Flat,
    files: &[(
        LEAD_BACKING_MODEL,
        "c59e3b9d2288cf8ad1099fe2b99e6de008d825aee2720f401c02bf63c596c127",
        53_249_592,
    )],
};

pub(crate) const LEAD_BACKING_GEOMETRY: ChunkGeometry = geometry(5120, 1024, 256, 2);

pub(crate) fn lead_backing_graph() -> Value {
    merge(
        LEAD_BACKING_GEOMETRY.fields(),
        json!({
            "inputName": "input",
            "outputName": "output",
            "dimF": 2048,
        }),
    )
}

const BUNDLES: [&ModelBundle; 6] = [
    &VOCALS,
    &LEAD_BACKING,
    &WHISPER,
    &BEAT_THIS,
    &CHORD_NET,
    &SKEY,
];

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
