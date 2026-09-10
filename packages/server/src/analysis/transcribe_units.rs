use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{Arc, Mutex, MutexGuard},
};

use axum::body::Bytes;
use bytemuck::cast_slice;
use musetric_gpu::{UnitCompleted, UnitPayload, UnitReject, UnitSession, UnitTarget, UnitWrite};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::{fs, sync::Notify};

use crate::analysis::browser::Failure;

const PART_SUFFIX: &str = ".part";
const OUTPUT: &str = "result";
const POISONED_UNITS: &str = "the transcription units are poisoned";
const STAGE_LOST: &str = "the attempt is not active";
const PLAN_NOT_READY: &str = "the transcription plan is not ready";
const OUTSIDE_PLAN: &str = "the unit is outside the plan";
const UNDECLARED: &str = "the unit output is not declared";
const TAIL_VERSION: u32 = 2;

pub(crate) const MAX_RESULT: u64 = 16 * 1024 * 1024;
pub(crate) const SEAM_SECONDS: f64 = 2.0;
pub(crate) const CHUNK_SIZE_SECONDS: f64 = 30.0;
pub(crate) const REPAIR_UNITS: u32 = 2;

#[cfg(test)]
mod tests;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
pub(crate) struct Span(pub(crate) f64, pub(crate) f64);

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct Word {
    pub(crate) text: String,
    pub(crate) start: f64,
    pub(crate) end: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct Replacement {
    pub(crate) index: u32,
    pub(crate) words: Vec<Word>,
}

#[derive(Clone)]
struct ChunkRange {
    from: usize,
    to: usize,
}

#[derive(Clone)]
pub(crate) struct Plan {
    pub(crate) language: String,
    pub(crate) packed: Vec<Vec<Span>>,
    chunks: Vec<ChunkRange>,
    compacted: Vec<f32>,
}

impl Plan {
    pub(crate) fn chunk_count(&self) -> u32 {
        u32::try_from(self.chunks.len()).unwrap_or(0)
    }
}

#[derive(Clone, Default)]
pub(crate) struct TranscribeState {
    pub(crate) plan: Option<Plan>,
    pub(crate) words: Vec<Vec<Word>>,
    pub(crate) replaced: Vec<Replacement>,
    result: Option<Value>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum StartPass {
    Decode,
    Repair,
}

pub(crate) struct Restored {
    pub(crate) state: TranscribeState,
    pub(crate) pass: StartPass,
    pub(crate) next_unit: u32,
}

struct Progress {
    attempt: String,
    pass: StartPass,
    opened: bool,
    state: TranscribeState,
    folded: HashSet<u32>,
}

fn pass_dir(pass: StartPass) -> &'static str {
    match pass {
        StartPass::Decode => "decode",
        StartPass::Repair => "repair",
    }
}

pub(crate) struct TranscribeUnits {
    root: PathBuf,
    input: Arc<Vec<f32>>,
    sample_rate: u32,
    progress: Mutex<Progress>,
    opened: Notify,
    folded_notify: Notify,
}

impl TranscribeUnits {
    pub(crate) fn create(
        root: PathBuf,
        input: Arc<Vec<f32>>,
        sample_rate: u32,
        state: TranscribeState,
    ) -> Self {
        Self {
            root,
            input,
            sample_rate,
            progress: Mutex::new(Progress {
                attempt: String::new(),
                pass: StartPass::Decode,
                opened: false,
                state,
                folded: HashSet::new(),
            }),
            opened: Notify::new(),
            folded_notify: Notify::new(),
        }
    }

    pub(crate) fn register(&self, attempt: &str) -> Result<(), Failure> {
        let mut progress = Self::lock(&self.progress)?;
        progress.attempt = String::from(attempt);
        Ok(())
    }

    pub(crate) fn set_pass(&self, pass: StartPass) -> Result<(), Failure> {
        let mut progress = Self::lock(&self.progress)?;
        progress.pass = pass;
        progress.folded.clear();
        Ok(())
    }

    pub(crate) fn pass_count(&self, pass: StartPass) -> Result<u32, Failure> {
        let progress = Self::lock(&self.progress)?;
        Ok(match pass {
            StartPass::Decode => 1 + progress.state.plan.as_ref().map_or(0, Plan::chunk_count),
            StartPass::Repair => REPAIR_UNITS,
        })
    }

    pub(crate) async fn wait_opened(&self) -> Result<(), Failure> {
        let wait = self.opened.notified();
        if Self::lock(&self.progress)?.opened {
            return Ok(());
        }
        wait.await;
        Ok(())
    }

    pub(crate) async fn folded(&self, unit: u32) -> Result<(), Failure> {
        loop {
            let wait = self.folded_notify.notified();
            if Self::lock(&self.progress)?.folded.contains(&unit) {
                return Ok(());
            }
            wait.await;
        }
    }

    pub(crate) fn tail(&self) -> Result<Vec<u8>, Failure> {
        let progress = Self::lock(&self.progress)?;
        tail_of(&progress.state).map_err(Failure::Refused)
    }

    pub(crate) fn finalize(&self) -> Result<Value, Failure> {
        let mut progress = Self::lock(&self.progress)?;
        progress
            .state
            .result
            .take()
            .ok_or_else(|| Failure::Refused("the attempt did not fold the result".to_owned()))
    }

    fn lock(lock: &Mutex<Progress>) -> Result<MutexGuard<'_, Progress>, Failure> {
        lock.lock()
            .map_err(|_| Failure::Refused(POISONED_UNITS.to_owned()))
    }

    fn guard(&self, attempt: &str, unit: u32) -> Result<MutexGuard<'_, Progress>, UnitReject> {
        let progress =
            Self::lock(&self.progress).map_err(|_| UnitReject::Bad(POISONED_UNITS.to_owned()))?;
        if progress.attempt != attempt {
            return Err(UnitReject::Stale);
        }
        if !Self::inside(&progress, unit) {
            return Err(UnitReject::Bad(OUTSIDE_PLAN.to_owned()));
        }
        Ok(progress)
    }

    fn inside(progress: &Progress, unit: u32) -> bool {
        match progress.pass {
            StartPass::Decode => {
                if unit == 0 {
                    return true;
                }
                let index = usize::try_from(unit - 1).unwrap_or(usize::MAX);
                progress
                    .state
                    .plan
                    .as_ref()
                    .is_some_and(|plan| index < plan.chunks.len())
            }
            StartPass::Repair => unit < REPAIR_UNITS,
        }
    }

    fn unit_dir(&self, pass: StartPass, attempt: &str, unit: u32) -> PathBuf {
        self.root
            .join(attempt)
            .join(pass_dir(pass))
            .join(unit.to_string())
    }

    fn ready_path(&self, pass: StartPass, attempt: &str, unit: u32) -> PathBuf {
        self.unit_dir(pass, attempt, unit).join(OUTPUT)
    }

    fn accept(&self, unit: u32, bytes: &[u8]) -> Result<(), String> {
        let mut progress = Self::lock(&self.progress).map_err(|_| POISONED_UNITS.to_owned())?;
        let value: Value =
            serde_json::from_slice(bytes).map_err(|_| "the unit output is not json".to_owned())?;
        match progress.pass {
            StartPass::Decode if unit == 0 => {
                let plan = validate_plan(&value, &self.input, self.sample_rate)?;
                progress.state.words = vec![Vec::new(); plan.chunks.len()];
                progress.state.plan = Some(plan);
            }
            StartPass::Decode => {
                let count = progress.state.plan.as_ref().map_or(0, Plan::chunk_count);
                let index = usize::try_from(unit - 1).map_err(|_| OUTSIDE_PLAN.to_owned())?;
                if index >= count as usize {
                    return Err(OUTSIDE_PLAN.to_owned());
                }
                progress.state.words[index] = parse_words(&value["words"])?;
            }
            StartPass::Repair if unit == 0 => {
                let chunks = progress.state.plan.as_ref().map_or(0, Plan::chunk_count);
                progress.state.replaced = parse_replaced(&value["replaced"], chunks)?;
            }
            StartPass::Repair => {
                if !value.is_array() {
                    return Err("the final output is not a segment list".to_owned());
                }
                progress.state.result = Some(value);
            }
        }
        progress.folded.insert(unit);
        Ok(())
    }
}

fn tail_of(state: &TranscribeState) -> Result<Vec<u8>, String> {
    let payload = json!({
        "version": TAIL_VERSION,
        "language": state.plan.as_ref().map_or(String::new(), |plan| plan.language.clone()),
        "packed": state.plan.as_ref().map_or(Vec::new(), |plan| plan.packed.clone()),
        "words": state.words,
        "replaced": state.replaced,
        "result": state.result,
    });
    serde_json::to_vec(&payload).map_err(|error| error.to_string())
}

pub(crate) fn restore_state(
    tail: &[u8],
    input: &[f32],
    sample_rate: u32,
) -> Result<TranscribeState, String> {
    let value: Value =
        serde_json::from_slice(tail).map_err(|_| "the tail is not json".to_owned())?;
    if value["version"].as_u64() != Some(u64::from(TAIL_VERSION)) {
        return Err("the tail version is unknown".to_owned());
    }
    let language = value["language"]
        .as_str()
        .ok_or_else(|| "the tail misses the language".to_owned())?
        .to_owned();
    let packed = parse_spans(&value["packed"])?;
    let plan = build_plan(language, packed, input, sample_rate)?;
    let words = value["words"]
        .as_array()
        .ok_or_else(|| "the tail misses the words".to_owned())?
        .iter()
        .map(parse_words)
        .collect::<Result<Vec<_>, _>>()?;
    if words.len() != plan.chunks.len() {
        return Err("the tail words do not match the plan".to_owned());
    }
    let replaced = parse_replaced(&value["replaced"], plan.chunk_count())?;
    let result = match &value["result"] {
        Value::Null => None,
        result if result.is_array() => Some(result.clone()),
        _ => return Err("the tail result is not a segment list".to_owned()),
    };
    Ok(TranscribeState {
        plan: Some(plan),
        words,
        replaced,
        result,
    })
}

fn validate_plan(value: &Value, input: &[f32], sample_rate: u32) -> Result<Plan, String> {
    let language = value["language"]
        .as_str()
        .ok_or_else(|| "the plan output misses the language".to_owned())?
        .to_owned();
    let packed = parse_spans(&value["packed"])?;
    build_plan(language, packed, input, sample_rate)
}

fn build_plan(
    language: String,
    packed: Vec<Vec<Span>>,
    input: &[f32],
    sample_rate: u32,
) -> Result<Plan, String> {
    let samples = input.len();
    let flat: Vec<Span> = packed.iter().flatten().copied().collect();
    #[expect(
        clippy::cast_precision_loss,
        reason = "sample counts index an in-memory signal"
    )]
    let duration = samples as f64 / f64::from(sample_rate);
    let mut previous_end = 0.0_f64;
    for span in &flat {
        if !(span.0.is_finite() && span.1.is_finite()) {
            return Err("the plan carries a non-finite span".to_owned());
        }
        if span.0 < -1e-9 || span.1 <= span.0 || span.1 > duration + 1e-9 {
            return Err("the plan carries a span outside the audio".to_owned());
        }
        if span.0 + 1e-9 < previous_end {
            return Err("the plan carries overlapping spans".to_owned());
        }
        previous_end = span.1;
    }
    if language.is_empty() && !flat.is_empty() {
        return Err("the plan misses the language".to_owned());
    }
    if pack_spans(&flat) != packed {
        return Err("the plan packing is not consistent".to_owned());
    }
    let (chunks, compacted) = assemble(&packed, input, sample_rate);
    Ok(Plan {
        language,
        packed,
        chunks,
        compacted,
    })
}

fn pack_spans(spans: &[Span]) -> Vec<Vec<Span>> {
    let mut packed: Vec<Vec<Span>> = Vec::new();
    let mut current: Vec<Span> = Vec::new();
    let mut total = 0.0_f64;
    for &span in spans {
        let duration = span.1 - span.0;
        let mut seam = if current.is_empty() {
            0.0
        } else {
            SEAM_SECONDS
        };
        if !current.is_empty() && total + seam + duration > CHUNK_SIZE_SECONDS {
            packed.push(current);
            current = Vec::new();
            total = 0.0;
            seam = 0.0;
        }
        current.push(span);
        total += seam + duration;
    }
    if !current.is_empty() {
        packed.push(current);
    }
    packed
}

#[expect(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "sample counts and pad lengths index an in-memory signal"
)]
fn assemble(packed: &[Vec<Span>], input: &[f32], sample_rate: u32) -> (Vec<ChunkRange>, Vec<f32>) {
    let samples = input.len();
    let rate = f64::from(sample_rate);
    let pad = (SEAM_SECONDS * rate).round().max(0.0) as usize;
    let mut compacted: Vec<f32> = Vec::new();
    let mut chunks = Vec::new();
    for group in packed {
        let from = compacted.len();
        let mut previous_end: Option<f64> = None;
        for span in group {
            let lo = (span.0 * rate).round().clamp(0.0, samples as f64) as usize;
            let hi = (span.1 * rate).round().clamp(0.0, samples as f64) as usize;
            if hi <= lo {
                continue;
            }
            if previous_end.is_some() && pad > 0 {
                compacted.resize(compacted.len() + pad, 0.0);
            }
            compacted.extend_from_slice(&input[lo..hi]);
            previous_end = Some(span.1);
        }
        if compacted.len() > from {
            chunks.push(ChunkRange {
                from,
                to: compacted.len(),
            });
        }
    }
    (chunks, compacted)
}

fn parse_spans(value: &Value) -> Result<Vec<Vec<Span>>, String> {
    let groups = value
        .as_array()
        .ok_or_else(|| "the plan misses the packed chunks".to_owned())?;
    groups
        .iter()
        .map(|group| {
            let spans = group
                .as_array()
                .ok_or_else(|| "the plan chunk is not a list".to_owned())?;
            spans
                .iter()
                .map(|span| {
                    let pair = span
                        .as_array()
                        .ok_or_else(|| "the plan span is not a pair".to_owned())?;
                    if pair.len() != 2 {
                        return Err("the plan span is not a pair".to_owned());
                    }
                    let start = pair[0]
                        .as_f64()
                        .ok_or_else(|| "the plan span is not numeric".to_owned())?;
                    let end = pair[1]
                        .as_f64()
                        .ok_or_else(|| "the plan span is not numeric".to_owned())?;
                    Ok(Span(start, end))
                })
                .collect()
        })
        .collect()
}

fn parse_words(value: &Value) -> Result<Vec<Word>, String> {
    let list = value
        .as_array()
        .ok_or_else(|| "the unit output misses the words".to_owned())?;
    list.iter()
        .map(|word| {
            let text = word["text"]
                .as_str()
                .ok_or_else(|| "the word misses the text".to_owned())?
                .to_owned();
            let start = word["start"]
                .as_f64()
                .ok_or_else(|| "the word misses the start".to_owned())?;
            let end = word["end"]
                .as_f64()
                .ok_or_else(|| "the word misses the end".to_owned())?;
            if !start.is_finite() || !end.is_finite() || start < -1e-9 || start > end + 1e-9 {
                return Err("the word carries an invalid span".to_owned());
            }
            Ok(Word { text, start, end })
        })
        .collect()
}

fn parse_replaced(value: &Value, chunks: u32) -> Result<Vec<Replacement>, String> {
    let list = value
        .as_array()
        .ok_or_else(|| "the repair output misses the replacements".to_owned())?;
    list.iter()
        .map(|entry| {
            let raw = entry["index"]
                .as_u64()
                .ok_or_else(|| "the replacement misses the index".to_owned())?;
            let index = u32::try_from(raw)
                .map_err(|_| "the replacement index is out of range".to_owned())?;
            if index >= chunks {
                return Err("the replacement index is out of range".to_owned());
            }
            let words = parse_words(&entry["words"])?;
            Ok(Replacement { index, words })
        })
        .collect()
}

fn sample_bytes(samples: &[f32]) -> Vec<u8> {
    cast_slice(samples).to_vec()
}

fn container(meta: &Value, payload: &[u8]) -> Result<Bytes, UnitReject> {
    let meta_bytes = serde_json::to_vec(meta)
        .map_err(|_| UnitReject::Bad("the unit meta is not serializable".to_owned()))?;
    let length = u32::try_from(meta_bytes.len())
        .map_err(|_| UnitReject::Bad("the unit meta is too long".to_owned()))?;
    let mut out = Vec::with_capacity(4 + meta_bytes.len() + payload.len());
    out.extend_from_slice(&length.to_le_bytes());
    out.extend_from_slice(&meta_bytes);
    out.extend_from_slice(payload);
    Ok(Bytes::from(out))
}

impl UnitSession for TranscribeUnits {
    fn window(&self, attempt: &str, unit: u32) -> Result<Bytes, UnitReject> {
        let progress = self.guard(attempt, unit)?;
        match progress.pass {
            StartPass::Decode if unit == 0 => {
                let meta = json!({ "kind": "plan" });
                container(&meta, &sample_bytes(&self.input))
            }
            StartPass::Decode => {
                let plan = progress
                    .state
                    .plan
                    .as_ref()
                    .ok_or_else(|| UnitReject::Bad(PLAN_NOT_READY.to_owned()))?;
                let index = usize::try_from(unit - 1)
                    .map_err(|_| UnitReject::Bad(OUTSIDE_PLAN.to_owned()))?;
                let chunk = &plan.chunks[index];
                let payload = sample_bytes(&plan.compacted[chunk.from..chunk.to]);
                let meta = json!({ "kind": "chunk", "language": plan.language });
                container(&meta, &payload)
            }
            StartPass::Repair if unit == 0 => {
                let plan = progress
                    .state
                    .plan
                    .as_ref()
                    .ok_or_else(|| UnitReject::Bad(PLAN_NOT_READY.to_owned()))?;
                let meta = json!({
                    "kind": "repair",
                    "language": plan.language,
                    "seamSeconds": SEAM_SECONDS,
                    "packed": plan.packed,
                    "words": progress.state.words,
                });
                container(&meta, &sample_bytes(&plan.compacted))
            }
            StartPass::Repair => {
                let plan = progress
                    .state
                    .plan
                    .as_ref()
                    .ok_or_else(|| UnitReject::Bad(PLAN_NOT_READY.to_owned()))?;
                let meta = json!({
                    "kind": "finalize",
                    "seamSeconds": SEAM_SECONDS,
                    "packed": plan.packed,
                    "words": progress.state.words,
                    "replaced": progress.state.replaced,
                });
                container(&meta, &sample_bytes(&plan.compacted))
            }
        }
    }

    fn target(&self, attempt: &str, unit: u32, output: &str) -> Result<UnitTarget, UnitReject> {
        if output != OUTPUT {
            return Err(UnitReject::Bad(UNDECLARED.to_owned()));
        }
        let progress = self.guard(attempt, unit)?;
        let pass = progress.pass;
        if progress.folded.contains(&unit) {
            return Ok(UnitTarget::Compare {
                ready: self.ready_path(pass, attempt, unit),
            });
        }
        Ok(UnitTarget::Write(UnitWrite::create(
            self.ready_path(pass, attempt, unit)
                .with_extension(PART_SUFFIX),
            self.ready_path(pass, attempt, unit),
            MAX_RESULT,
            UnitPayload::Bytes,
        )))
    }

    fn completed<'a>(&'a self, attempt: &'a str, unit: u32, _output: &'a str) -> UnitCompleted<'a> {
        Box::pin(async move {
            let pass = Self::lock(&self.progress)
                .map_err(|_| POISONED_UNITS.to_owned())?
                .pass;
            let bytes = fs::read(self.ready_path(pass, attempt, unit))
                .await
                .map_err(|error| error.to_string())?;
            self.accept(unit, &bytes)?;
            self.folded_notify.notify_waiters();
            let _ = fs::remove_dir_all(self.unit_dir(pass, attempt, unit)).await;
            Ok(())
        })
    }

    fn aborted(&self, _attempt: &str, _unit: u32, _output: &str) {}

    fn opened(&self, _attempt: &str) -> Result<(), String> {
        {
            let mut progress = Self::lock(&self.progress).map_err(|_| POISONED_UNITS.to_owned())?;
            progress.opened = true;
        }
        self.opened.notify_waiters();
        Ok(())
    }

    fn done(&self, attempt: &str, unit: u32) -> Result<(), String> {
        self.guard(attempt, unit)
            .map(|_| ())
            .map_err(|reject| match reject {
                UnitReject::Stale => STAGE_LOST.to_owned(),
                UnitReject::Bad(reason) => reason,
            })
    }
}
