use std::{
    fmt::Write,
    path::{Path, PathBuf},
};

use sha2::{Digest, Sha256};
use tokio::fs::{self, create_dir_all};

use musetric_db::BoxedError;

const TAIL_NAME: &str = "separated.tail";
const INPUT_NAME: &str = "input.f32";
const CHECKPOINTS: &str = "checkpoints";
const INCOMING: &str = "incoming";

#[derive(Clone)]
pub(crate) struct CheckpointDir {
    root: PathBuf,
}

pub(crate) struct StoredTail {
    pub(crate) bytes: Vec<u8>,
    pub(crate) digest: String,
}

impl CheckpointDir {
    pub(crate) fn create(root: PathBuf) -> Self {
        Self { root }
    }

    pub(crate) fn incoming_root(&self) -> PathBuf {
        self.root.join(INCOMING)
    }

    fn generation_dir(&self, generation: u32) -> PathBuf {
        self.root.join(CHECKPOINTS).join(generation.to_string())
    }

    fn tail_path(&self, generation: u32) -> PathBuf {
        self.generation_dir(generation).join(TAIL_NAME)
    }

    pub(crate) async fn write_samples(
        &self,
        name: &str,
        samples: &[f32],
    ) -> Result<(), BoxedError> {
        create_dir_all(&self.root).await?;
        fs::write(self.root.join(name), encode_samples(samples)).await?;
        Ok(())
    }

    pub(crate) async fn write_input(&self, samples: &[f32]) -> Result<(), BoxedError> {
        self.write_samples(INPUT_NAME, samples).await
    }

    #[cfg(test)]
    pub(crate) async fn read_samples(&self, name: &str) -> Result<Vec<f32>, BoxedError> {
        let bytes = fs::read(self.root.join(name)).await?;
        decode_samples(&bytes).ok_or_else(|| "the stored signal is not frame aligned".into())
    }

    #[cfg(test)]
    pub(crate) async fn read_input(&self) -> Result<Vec<f32>, BoxedError> {
        self.read_samples(INPUT_NAME).await
    }

    pub(crate) async fn write_tail(
        &self,
        generation: u32,
        bytes: &[u8],
    ) -> Result<StoredTail, BoxedError> {
        let directory = self.generation_dir(generation);
        create_dir_all(&directory).await?;
        let path = self.tail_path(generation);
        let part = path.with_extension("tail.part");
        fs::write(&part, bytes).await?;
        fs::rename(&part, &path).await?;
        Ok(StoredTail {
            digest: digest_of(bytes),
            bytes: bytes.to_vec(),
        })
    }

    pub(crate) async fn read_tail(&self, generation: u32) -> Result<StoredTail, BoxedError> {
        let bytes = fs::read(self.tail_path(generation)).await?;
        Ok(StoredTail {
            digest: digest_of(&bytes),
            bytes,
        })
    }

    pub(crate) async fn discard(&self, generation: u32) {
        let _ = fs::remove_dir_all(self.generation_dir(generation)).await;
    }
}

pub(crate) fn digest_samples(samples: &[f32]) -> String {
    digest_of(&encode_samples(samples))
}

pub(crate) fn digest_of(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .fold(String::new(), |mut text, byte| {
            let _ = write!(text, "{byte:02x}");
            text
        })
}

pub(crate) fn computation_id(parts: &[&str]) -> String {
    digest_of(parts.join("|").as_bytes())
}

fn encode_samples(samples: &[f32]) -> Vec<u8> {
    samples
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect()
}

#[cfg(test)]
fn decode_samples(bytes: &[u8]) -> Option<Vec<f32>> {
    if !bytes.len().is_multiple_of(4) {
        return None;
    }
    Some(
        bytes
            .chunks_exact(4)
            .filter_map(|raw| {
                raw.first_chunk::<4>()
                    .map(|value| f32::from_le_bytes(*value))
            })
            .collect(),
    )
}

pub(crate) fn restore_refused(reason: &str) -> String {
    format!("the checkpoint cannot be restored: {reason}")
}

pub(crate) fn area_root(work: &Path, project_id: i64, step: &str, computation: &str) -> PathBuf {
    work.join(project_id.to_string())
        .join(step)
        .join(computation)
}

#[cfg(test)]
mod tests;
