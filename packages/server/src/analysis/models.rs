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
    revision: "a951177c3583b157ca20fe487823b9c232c02487",
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
    revision: "90095e00d1b6eb1212e939a98665844436f0de93",
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
            "d27943f0f3ee4fdfc33241a64d68fffd40ce0f2344ee21f73d37abac9ebd1a43",
            432_766_809,
        ),
        (
            "decoder_model_merged_fp16.onnx",
            "e2a1a41955518f5b57d4710a4bdb7c93f5efd3d77e81e055ec8ec80126d8fdb8",
            317_745_737,
        ),
        (
            "cross_kv_fp16.onnx",
            "45b5271bd4f69e16a6e59a624698de9db2c065d38fd55ce67f69271414d9ef84",
            26_228_595,
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

pub(crate) const VOCALS_MODEL: &str = "duality_core_t1100.onnx";
pub(crate) const VOCALS_MODEL_DATA: &str = "duality_core_t1100.onnx.data";

pub(crate) const VOCALS: ModelBundle = ModelBundle {
    label: "Vocals separation model",
    model_id: "musetric/aname-mel-band-roformer-duality-onnx",
    revision: "d5f619c91e5fec8647309e34ccc4a8ba7f235580",
    directory: "aname-mel-band-roformer-duality-onnx",
    sample_rate: 44100,
    downmix: Downmix::Power,
    layout: CacheLayout::Flat,
    files: &[
        (
            VOCALS_MODEL,
            "1ae7a97c87d854cc27259a5be5115adfe8e44d046390819a6b2fe259465f5a77",
            7_306_315,
        ),
        (
            VOCALS_MODEL_DATA,
            "ba2a1daacde1608a57564c7bb24a3efe2f50388b2168143044019a6cbe3f21c6",
            456_274_828,
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
    revision: "e53029c556d3db1386c6b919a1e2e1f1ac750457",
    directory: "uvr-mdxnet-kara2-onnx",
    sample_rate: 44100,
    downmix: Downmix::Power,
    layout: CacheLayout::Flat,
    files: &[(
        LEAD_BACKING_MODEL,
        "f90e997ad60af6bf25bac77ad02f5e127a564d363a2b60ecb41100cd83e4ba12",
        52_832_612,
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
