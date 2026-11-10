use std::{
    collections::HashSet,
    io::SeekFrom,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, MutexGuard,
        atomic::{AtomicU32, Ordering},
    },
};

use axum::body::Bytes;
use musetric_db::ProcessingStep;
use musetric_gpu::{UnitCompleted, UnitPayload, UnitReject, UnitSession, UnitTarget, UnitWrite};
use tokio::{
    fs::{self, File, OpenOptions},
    io::{AsyncSeekExt, AsyncWriteExt, copy},
    sync::Mutex as CommitLock,
};

use crate::{
    analysis::{
        browser::Failure,
        checkpoint_persist::{CheckpointCursor, persist_tail},
    },
    checkpoint::CheckpointDir,
    storage::Storage,
};

pub(crate) const STATE_OUTPUT: &str = "state";
pub(crate) const FRAME_BYTES: u64 = 8;
const STATE_BYTES_LIMIT: u64 = 64 << 20;
const PART_SUFFIX: &str = ".part";
const POISONED: &str = "the separation sink is poisoned";

pub(crate) struct SinkStem {
    pub(crate) name: &'static str,
    pub(crate) raw: PathBuf,
}

pub(crate) struct SinkCheckpoint {
    pub(crate) storage: Arc<Storage>,
    pub(crate) directory: CheckpointDir,
    pub(crate) project_id: i64,
    pub(crate) step: ProcessingStep,
    pub(crate) attempt: String,
    pub(crate) computation: String,
    pub(crate) pass: &'static str,
}

#[derive(Clone, Copy)]
pub(crate) struct SinkCursor {
    pub(crate) next_unit: u32,
    pub(crate) frames: u64,
}

pub(crate) struct SinkOptions {
    pub(crate) checkpoint: SinkCheckpoint,
    pub(crate) stems: Vec<SinkStem>,
    pub(crate) frames: u64,
    pub(crate) cursor: SinkCursor,
    pub(crate) unit_count: Arc<AtomicU32>,
}

pub(crate) struct SeparationSink {
    checkpoint: SinkCheckpoint,
    stems: Vec<SinkStem>,
    frames: u64,
    unit_count: Arc<AtomicU32>,
    state: Mutex<SinkState>,
    committing: CommitLock<()>,
}

struct SinkState {
    accepted: HashSet<(u32, String)>,
    cursor: SinkCursor,
}

impl SeparationSink {
    pub(crate) fn create(options: SinkOptions) -> Self {
        Self {
            checkpoint: options.checkpoint,
            stems: options.stems,
            frames: options.frames,
            unit_count: options.unit_count,
            state: Mutex::new(SinkState {
                accepted: HashSet::new(),
                cursor: options.cursor,
            }),
            committing: CommitLock::new(()),
        }
    }

    pub(crate) fn cursor(&self) -> Result<SinkCursor, Failure> {
        Ok(self.lock().map_err(Failure::Refused)?.cursor)
    }

    fn lock(&self) -> Result<MutexGuard<'_, SinkState>, String> {
        self.state.lock().map_err(|_| POISONED.to_owned())
    }

    fn unit_dir(&self, unit: u32) -> PathBuf {
        self.checkpoint
            .directory
            .incoming_root()
            .join(&self.checkpoint.attempt)
            .join(unit.to_string())
    }

    fn ready_path(&self, unit: u32, output: &str) -> PathBuf {
        self.unit_dir(unit).join(output)
    }

    fn outputs(&self) -> impl Iterator<Item = &str> {
        self.stems
            .iter()
            .map(|stem| stem.name)
            .chain([STATE_OUTPUT])
    }

    fn accept(&self, unit: u32, output: &str) -> Result<bool, String> {
        let mut guard = self.lock()?;
        guard.accepted.insert((unit, output.to_owned()));
        Ok(self
            .outputs()
            .all(|name| guard.accepted.contains(&(unit, name.to_owned()))))
    }

    async fn commit(&self, unit: u32) -> Result<(), String> {
        let _serial = self.committing.lock().await;
        let cursor = self.lock()?.cursor;
        if unit != 0 && unit != cursor.next_unit {
            return Err(format!("unit {unit} is not the next unit to commit"));
        }
        let offset = if unit == 0 { 0 } else { cursor.frames };
        let region = self.region_frames(unit).await?;
        let frames = offset + region;
        if frames > self.frames {
            return Err("the stems run past the end of the track".to_owned());
        }
        for stem in &self.stems {
            append_at(
                &stem.raw,
                offset * FRAME_BYTES,
                &self.ready_path(unit, stem.name),
            )
            .await
            .map_err(|error| error.to_string())?;
        }
        let state = fs::read(self.ready_path(unit, STATE_OUTPUT))
            .await
            .map_err(|error| error.to_string())?;
        let checkpoint = &self.checkpoint;
        persist_tail(
            &checkpoint.storage,
            &checkpoint.directory,
            state,
            CheckpointCursor {
                project_id: checkpoint.project_id,
                step: checkpoint.step,
                attempt_id: &checkpoint.attempt,
                computation_id: &checkpoint.computation,
                pass: checkpoint.pass,
                next_unit: unit + 1,
                unit_count: self.unit_count.load(Ordering::Relaxed),
                prefix_frames: u32::try_from(frames)
                    .map_err(|_| "the track is too long to checkpoint".to_owned())?,
            },
        )
        .await
        .map_err(|failure| match failure {
            Failure::Refused(reason) => reason,
            Failure::ExecutorAbsent | Failure::ExecutorLost => {
                "the executor left while the unit was committed".to_owned()
            }
        })?;
        {
            let mut guard = self.lock()?;
            guard.cursor = SinkCursor {
                next_unit: unit + 1,
                frames,
            };
            guard.accepted.retain(|(accepted, _)| *accepted != unit);
        }
        let _ = fs::remove_dir_all(self.unit_dir(unit)).await;
        Ok(())
    }

    async fn region_frames(&self, unit: u32) -> Result<u64, String> {
        let mut found: Option<u64> = None;
        for stem in &self.stems {
            let bytes = fs::metadata(self.ready_path(unit, stem.name))
                .await
                .map_err(|error| error.to_string())?
                .len();
            if found.is_some_and(|length| length != bytes) {
                return Err("the stems of a unit differ in length".to_owned());
            }
            found = Some(bytes);
        }
        let bytes = found.unwrap_or_default();
        if !bytes.is_multiple_of(FRAME_BYTES) {
            return Err("the stems of a unit are not whole stereo frames".to_owned());
        }
        Ok(bytes / FRAME_BYTES)
    }
}

async fn append_at(raw: &Path, offset: u64, region: &Path) -> std::io::Result<()> {
    if let Some(directory) = raw.parent() {
        fs::create_dir_all(directory).await?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(raw)
        .await?;
    file.set_len(offset).await?;
    file.seek(SeekFrom::Start(offset)).await?;
    let mut source = File::open(region).await?;
    copy(&mut source, &mut file).await?;
    file.flush().await
}

pub(crate) async fn truncate_stems(stems: &[SinkStem], frames: u64) -> std::io::Result<()> {
    let length = frames * FRAME_BYTES;
    for stem in stems {
        let file = OpenOptions::new().write(true).open(&stem.raw).await?;
        if file.metadata().await?.len() < length {
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "the stem is shorter than its checkpoint",
            ));
        }
        file.set_len(length).await?;
    }
    Ok(())
}

impl UnitSession for SeparationSink {
    fn window(&self, _attempt: &str, _unit: u32) -> Result<Bytes, UnitReject> {
        Err(UnitReject::Bad(
            "the separation reads its mixture as a file".to_owned(),
        ))
    }

    fn target(&self, attempt: &str, unit: u32, output: &str) -> Result<UnitTarget, UnitReject> {
        if attempt != self.checkpoint.attempt {
            return Err(UnitReject::Stale);
        }
        if !self.outputs().any(|name| name == output) {
            return Err(UnitReject::Bad(format!(
                "the unit output {output} is not declared"
            )));
        }
        let guard = self.lock().map_err(UnitReject::Bad)?;
        let next = guard.cursor.next_unit;
        if unit != 0 && unit < next {
            return Ok(UnitTarget::Confirm);
        }
        if unit != 0 && unit > next {
            return Err(UnitReject::Bad(format!(
                "unit {unit} comes before unit {next} is committed"
            )));
        }
        let ready = self.ready_path(unit, output);
        if guard.accepted.contains(&(unit, output.to_owned())) {
            return Ok(UnitTarget::Compare { ready });
        }
        let part = self.unit_dir(unit).join(format!("{output}{PART_SUFFIX}"));
        let write = if output == STATE_OUTPUT {
            UnitWrite::create(part, ready, STATE_BYTES_LIMIT, UnitPayload::Bytes)
        } else {
            UnitWrite::create(part, ready, self.frames * FRAME_BYTES, UnitPayload::Floats)
        };
        Ok(UnitTarget::Write(write))
    }

    fn completed<'a>(&'a self, attempt: &'a str, unit: u32, output: &'a str) -> UnitCompleted<'a> {
        Box::pin(async move {
            if attempt != self.checkpoint.attempt {
                return Err("the attempt is not active".to_owned());
            }
            if self.accept(unit, output)? {
                self.commit(unit).await?;
            }
            Ok(())
        })
    }

    fn aborted(&self, _attempt: &str, _unit: u32, _output: &str) {}

    fn opened(&self, _attempt: &str) -> Result<(), String> {
        Ok(())
    }

    fn done(&self, _attempt: &str, _unit: u32) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(test)]
mod tests;
