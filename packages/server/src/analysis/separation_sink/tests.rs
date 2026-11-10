use std::sync::{Arc, atomic::AtomicU32};

use musetric_db::ProcessingStep;
use musetric_gpu::{UnitReject, UnitSession, UnitTarget};
use reqwest::{Client, StatusCode};

use super::{
    FRAME_BYTES, STATE_OUTPUT, SeparationSink, SinkCheckpoint, SinkCursor, SinkOptions, SinkStem,
    truncate_stems,
};
use crate::{checkpoint::CheckpointDir, storage::Storage, test_workspace::Workspace};

const ATTEMPT: &str = "attempt";
const STEMS: [&str; 4] = ["vocals", "instrumental", "lead", "backing"];
const TRACK_FRAMES: u64 = 10;

struct Fixture {
    workspace: Workspace,
    storage: Arc<Storage>,
}

impl Fixture {
    fn new() -> Self {
        let workspace = Workspace::new();
        workspace.seed(
            "INSERT INTO Project (id, name, sampleRate, frameCount)
             VALUES (1, 'Fixture project', 44100, 441000);
             INSERT INTO ProcessingStep (projectId, step, status, attemptId)
             VALUES (1, 'separation', 'processing', 'attempt');",
        );
        let storage = workspace.create_storage();
        Self { workspace, storage }
    }

    fn stems(&self) -> Vec<SinkStem> {
        STEMS
            .into_iter()
            .map(|name| SinkStem {
                name,
                raw: self.workspace.work_path().join(format!("{name}.raw")),
            })
            .collect()
    }

    fn sink(&self, cursor: SinkCursor) -> SeparationSink {
        SeparationSink::create(SinkOptions {
            checkpoint: SinkCheckpoint {
                storage: Arc::clone(&self.storage),
                directory: CheckpointDir::create(self.workspace.work_path().join("checkpoint")),
                project_id: 1,
                step: ProcessingStep::Separation,
                attempt: ATTEMPT.to_owned(),
                computation: "computation".to_owned(),
                pass: "vocals",
            },
            stems: self.stems(),
            frames: TRACK_FRAMES,
            cursor,
            unit_count: Arc::new(AtomicU32::new(3)),
        })
    }

    fn raw(&self, name: &str) -> Vec<u8> {
        std::fs::read(self.workspace.work_path().join(format!("{name}.raw")))
            .expect("the stem should be written")
    }
}

const START: SinkCursor = SinkCursor {
    next_unit: 0,
    frames: 0,
};

fn region(frames: u64, seed: u8) -> Vec<u8> {
    (0..frames * FRAME_BYTES)
        .map(|index| seed.wrapping_add(u8::try_from(index % 200).unwrap_or(0)))
        .collect()
}

async fn put(sink: &SeparationSink, unit: u32, output: &str, bytes: &[u8]) -> Result<(), String> {
    let path = sink.ready_path(unit, output);
    std::fs::create_dir_all(path.parent().expect("the unit has a directory"))
        .expect("the unit directory should be created");
    std::fs::write(&path, bytes).expect("the output should be written");
    sink.completed(ATTEMPT, unit, output).await
}

async fn put_unit(sink: &SeparationSink, unit: u32, frames: u64, seed: u8) -> Result<(), String> {
    for (offset, name) in STEMS.into_iter().enumerate() {
        put(
            sink,
            unit,
            name,
            &region(frames, seed + u8::try_from(offset).unwrap_or(0)),
        )
        .await?;
    }
    put(sink, unit, STATE_OUTPUT, &[seed; 3]).await
}

#[tokio::test]
async fn appends_each_unit_at_the_committed_frames() {
    let fixture = Fixture::new();
    let sink = fixture.sink(START);
    put_unit(&sink, 0, 4, 1)
        .await
        .expect("unit 0 should commit");
    put_unit(&sink, 1, 3, 9)
        .await
        .expect("unit 1 should commit");

    assert_eq!(fixture.raw("vocals"), [region(4, 1), region(3, 9)].concat());
    assert_eq!(
        fixture.raw("backing"),
        [region(4, 4), region(3, 12)].concat()
    );
    let cursor = fixture
        .storage
        .database
        .step_checkpoint(1, ProcessingStep::Separation)
        .expect("the checkpoint should be readable")
        .expect("the checkpoint should be stored");
    assert_eq!(cursor.next_unit, 2);
    assert_eq!(cursor.unit_count, 3);
    assert_eq!(cursor.prefix_frames, 7);
    assert_eq!(sink.cursor().map(|found| found.frames).ok(), Some(7));
}

#[tokio::test]
async fn confirms_a_committed_unit_and_refuses_one_out_of_turn() {
    let fixture = Fixture::new();
    let sink = fixture.sink(START);
    put_unit(&sink, 0, 4, 1)
        .await
        .expect("unit 0 should commit");
    put_unit(&sink, 1, 3, 9)
        .await
        .expect("unit 1 should commit");

    assert!(matches!(
        sink.target(ATTEMPT, 1, "vocals"),
        Ok(UnitTarget::Confirm)
    ));
    assert!(matches!(
        sink.target(ATTEMPT, 3, "vocals"),
        Err(UnitReject::Bad(_))
    ));
    assert!(matches!(
        sink.target(ATTEMPT, 2, "drums"),
        Err(UnitReject::Bad(_))
    ));
    assert!(matches!(
        sink.target("other", 2, "vocals"),
        Err(UnitReject::Stale)
    ));
    assert!(matches!(
        sink.target(ATTEMPT, 2, "vocals"),
        Ok(UnitTarget::Write(_))
    ));
}

#[tokio::test]
async fn starts_over_from_the_first_unit() {
    let fixture = Fixture::new();
    let sink = fixture.sink(START);
    put_unit(&sink, 0, 4, 1)
        .await
        .expect("unit 0 should commit");
    put_unit(&sink, 1, 3, 9)
        .await
        .expect("unit 1 should commit");
    put_unit(&sink, 0, 2, 20)
        .await
        .expect("unit 0 should commit again");

    assert_eq!(fixture.raw("lead"), region(2, 22));
    assert_eq!(sink.cursor().map(|found| found.next_unit).ok(), Some(1));
}

#[tokio::test]
async fn refuses_stems_that_differ_in_length_or_run_past_the_track() {
    let fixture = Fixture::new();
    let sink = fixture.sink(START);
    for name in ["vocals", "instrumental", "lead"] {
        put(&sink, 0, name, &region(4, 1))
            .await
            .expect("the stem should land");
    }
    put(&sink, 0, "backing", &region(3, 1))
        .await
        .expect("the stem should land");
    assert!(put(&sink, 0, STATE_OUTPUT, &[1]).await.is_err());

    let other = Fixture::new();
    let past = other.sink(START);
    assert!(put_unit(&past, 0, TRACK_FRAMES + 1, 1).await.is_err());
}

#[tokio::test]
async fn resumes_on_stems_cut_back_to_the_checkpoint() {
    let fixture = Fixture::new();
    let first = fixture.sink(START);
    put_unit(&first, 0, 4, 1)
        .await
        .expect("unit 0 should commit");
    put_unit(&first, 1, 3, 9)
        .await
        .expect("unit 1 should commit");
    let stems = fixture.stems();

    truncate_stems(&stems, 4)
        .await
        .expect("the stems should be cut");
    let resumed = fixture.sink(SinkCursor {
        next_unit: 1,
        frames: 4,
    });
    put_unit(&resumed, 1, 3, 30)
        .await
        .expect("unit 1 should commit");

    assert_eq!(
        fixture.raw("vocals"),
        [region(4, 1), region(3, 30)].concat()
    );
    assert!(truncate_stems(&stems, 8).await.is_err());
}

async fn put_over_http(base: &str, unit: u32, output: &str, body: Vec<u8>) -> StatusCode {
    Client::new()
        .put(format!("{base}/attempt/{ATTEMPT}/unit/{unit}/{output}"))
        .body(body)
        .send()
        .await
        .expect("the output should answer")
        .status()
}

fn floats(values: &[f32]) -> Vec<u8> {
    values
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect()
}

#[tokio::test]
async fn takes_the_outputs_of_a_unit_over_http() {
    let fixture = Fixture::new();
    let sink = Arc::new(fixture.sink(START));
    let host = fixture
        .workspace
        .start_unit_host(
            "Fixture separation",
            Arc::clone(&sink) as Arc<dyn UnitSession>,
        )
        .await;
    let base = host.base_url().to_owned();
    let stem = floats(&[0.5, -0.5, 0.25, 0.0]);
    for name in STEMS {
        assert_eq!(
            put_over_http(&base, 0, name, stem.clone()).await,
            StatusCode::NO_CONTENT
        );
    }
    assert_eq!(
        put_over_http(&base, 0, STATE_OUTPUT, vec![7; 5]).await,
        StatusCode::NO_CONTENT
    );
    let broken = floats(&[f32::NAN, 0.0]);
    let long = floats(&vec![
        0.0;
        2 * usize::try_from(TRACK_FRAMES).unwrap_or(0) + 2
    ]);

    assert_eq!(fixture.raw("vocals"), stem);
    assert_eq!(sink.cursor().map(|found| found.frames).ok(), Some(2));
    assert_eq!(
        put_over_http(&base, 1, "vocals", broken).await,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        put_over_http(&base, 1, "lead", long).await,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        put_over_http(&base, 1, "backing", Vec::new()).await,
        StatusCode::NO_CONTENT
    );
    host.close().await;
}
