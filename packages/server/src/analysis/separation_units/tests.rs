use std::{
    path::PathBuf,
    process::id,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use futures_util::{SinkExt, StreamExt};
use musetric_gpu::{Bundle, ExecutorHost, ExecutorHostOptions, PhaseSink, UnitSession};
use reqwest::{Client, StatusCode};
use serde_json::{Value, json};
use tokio::time::timeout;
use tokio_tungstenite::{connect_async, tungstenite::Message as ClientMessage};

use super::{SeparationUnits, StageRegistration};
use crate::unit_plan::{PlanRules, PlanUnit, UnitPlan};

const ANSWER: Duration = Duration::from_secs(5);
const ATTEMPT: &str = "attempt-1";
const EXPECTED: usize = 32;
struct Workspace {
    directory: PathBuf,
}

impl Workspace {
    fn new() -> Self {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("the clock should be after the epoch")
            .as_nanos();
        let ordinal = WORKSPACE_COUNT.fetch_add(1, Ordering::Relaxed);
        let directory =
            std::env::temp_dir().join(format!("musetric-units-{}-{stamp}-{ordinal}", id()));
        std::fs::create_dir_all(directory.join("bundle")).expect("the workspace should be created");
        std::fs::write(directory.join("bundle").join("index.js"), "fixture;")
            .expect("the bundle asset should be written");
        Self { directory }
    }

    fn bundle_path(&self) -> PathBuf {
        self.directory.join("bundle")
    }

    fn incoming(&self) -> PathBuf {
        self.directory.join("incoming")
    }
}

impl Drop for Workspace {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}

static WORKSPACE_COUNT: AtomicUsize = AtomicUsize::new(0);

async fn start_units(workspace: &Workspace) -> (ExecutorHost, Arc<SeparationUnits>) {
    let units = Arc::new(SeparationUnits::create(workspace.incoming()));
    let sink: PhaseSink = Arc::new(|_| {});
    let host = ExecutorHost::start(ExecutorHostOptions {
        label: "Fixture separation".to_owned(),
        bundle: Bundle::Directory(workspace.bundle_path()),
        pcm: Vec::new().into(),
        require_shader_f16: false,
        on_phase: sink,
        units: Some(Arc::clone(&units) as Arc<dyn UnitSession>),
    })
    .await
    .expect("the host should start");
    (host, units)
}

fn registration(attempt: &str, outputs: &[&str]) -> StageRegistration {
    let plan = UnitPlan::create(
        PlanRules::LeadBackingV1,
        2,
        4,
        vec![
            PlanUnit {
                start: 0,
                length: 4,
            },
            PlanUnit {
                start: 2,
                length: 4,
            },
        ],
    );
    StageRegistration {
        attempt: attempt.to_owned(),
        plan,
        input: Arc::new(vec![
            1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0,
        ]),
        outputs: outputs.iter().map(|name| (*name).to_owned()).collect(),
        rules: PlanRules::LeadBackingV1,
    }
}

fn samples(chunk: [f32; 4]) -> Vec<u8> {
    let channel: Vec<u8> = chunk.iter().copied().flat_map(f32::to_le_bytes).collect();
    [channel.clone(), channel].concat()
}

async fn get_window(base: &str, attempt: &str, unit: u32) -> (StatusCode, Vec<u8>) {
    let response = Client::new()
        .get(format!("{base}/attempt/{attempt}/unit/{unit}"))
        .send()
        .await
        .expect("the window should answer");
    let status = response.status();
    (
        status,
        response.bytes().await.expect("the window body").to_vec(),
    )
}

async fn put_output(url: String, body: Vec<u8>) -> StatusCode {
    Client::new()
        .put(url)
        .body(body)
        .send()
        .await
        .expect("the output should answer")
        .status()
}

fn output_url(base: &str, attempt_id: &str, unit: u32, name: &str) -> String {
    format!("{base}/attempt/{attempt_id}/unit/{unit}/{name}")
}

#[tokio::test]
async fn serves_exactly_the_declared_window() {
    let workspace = Workspace::new();
    let (host, units) = start_units(&workspace).await;
    units
        .register(registration(ATTEMPT, &["a"]))
        .expect("the stage should register");
    let base = host.base_url().to_owned();

    let (status, body) = get_window(&base, ATTEMPT, 0).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.len(), EXPECTED);
    let found: Vec<f32> = body
        .chunks_exact(4)
        .map(|raw| f32::from_le_bytes(raw.try_into().expect("four bytes")))
        .collect();
    assert_eq!(&found[0..4], &[1.0, 2.0, 3.0, 4.0]);
    assert_eq!(&found[4..8], &[7.0, 8.0, 9.0, 10.0]);

    let (missing_unit, _) = get_window(&base, ATTEMPT, 9).await;
    assert_eq!(missing_unit, StatusCode::BAD_REQUEST);
    let (foreign, _) = get_window(&base, "other", 0).await;
    assert_eq!(foreign, StatusCode::CONFLICT);
    host.close().await;
}

#[tokio::test]
async fn folds_a_unit_once_its_output_is_complete() {
    let workspace = Workspace::new();
    let (host, units) = start_units(&workspace).await;
    units
        .register(registration(ATTEMPT, &["a"]))
        .expect("the stage should register");
    let base = host.base_url().to_owned();

    let stored = put_output(
        output_url(&base, ATTEMPT, 0, "a"),
        samples([1.0, 0.5, -0.25, 2.0]),
    )
    .await;
    assert_eq!(stored, StatusCode::NO_CONTENT);
    timeout(ANSWER, units.folded(ATTEMPT, 0))
        .await
        .expect("the fold should not hang")
        .expect("the unit should fold");
    assert!(!workspace.incoming().join(ATTEMPT).join("0").exists());

    let repeated = put_output(
        output_url(&base, ATTEMPT, 0, "a"),
        samples([1.0, 0.5, -0.25, 2.0]),
    )
    .await;
    assert_eq!(repeated, StatusCode::NO_CONTENT);
    let changed = put_output(
        output_url(&base, ATTEMPT, 0, "a"),
        samples([9.0, 0.5, -0.25, 2.0]),
    )
    .await;
    assert_eq!(changed, StatusCode::NO_CONTENT);

    let second = put_output(
        output_url(&base, ATTEMPT, 1, "a"),
        samples([0.5, 0.5, 0.5, 0.5]),
    )
    .await;
    assert_eq!(second, StatusCode::NO_CONTENT);
    timeout(ANSWER, units.folded(ATTEMPT, 1))
        .await
        .expect("the fold should not hang")
        .expect("the last unit should fold");
    let finalized = units.finalize(ATTEMPT).expect("the stage should finalize");
    let expected = [0.0_f32, 0.5, -0.25, 0.5, 0.5, 0.0];
    assert_eq!(finalized.len(), 12);
    for channel in 0..2 {
        for (position, value) in expected.iter().enumerate() {
            let found = f64::from(finalized[channel * 6 + position]);
            assert!((found - f64::from(*value)).abs() < 1e-6);
        }
    }
    host.close().await;
}

#[tokio::test]
async fn keeps_the_fold_untouched_after_a_truncated_output() {
    let workspace = Workspace::new();
    let (host, units) = start_units(&workspace).await;
    units
        .register(registration(ATTEMPT, &["a"]))
        .expect("the stage should register");
    let base = host.base_url().to_owned();

    let truncated = put_output(output_url(&base, ATTEMPT, 0, "a"), vec![0_u8; 16]).await;
    assert_eq!(truncated, StatusCode::BAD_REQUEST);
    assert!(
        !workspace
            .incoming()
            .join(ATTEMPT)
            .join("0")
            .join("a.part")
            .exists()
    );
    let waiting = units.folded(ATTEMPT, 0);
    let pending = timeout(Duration::from_millis(100), waiting).await;
    assert!(
        pending.is_err(),
        "a truncated output must not fold the unit"
    );

    let complete = put_output(
        output_url(&base, ATTEMPT, 0, "a"),
        samples([1.0, 0.5, -0.25, 2.0]),
    )
    .await;
    assert_eq!(complete, StatusCode::NO_CONTENT);
    timeout(ANSWER, units.folded(ATTEMPT, 0))
        .await
        .expect("the fold should not hang")
        .expect("the unit should fold after the retry");
    host.close().await;
}

#[tokio::test]
async fn refuses_a_repeated_output_that_carries_other_bytes() {
    let workspace = Workspace::new();
    let (host, units) = start_units(&workspace).await;
    units
        .register(registration(ATTEMPT, &["a", "b"]))
        .expect("the stage should register");
    let base = host.base_url().to_owned();

    let first = put_output(
        output_url(&base, ATTEMPT, 0, "a"),
        samples([1.0, 0.5, -0.25, 2.0]),
    )
    .await;
    assert_eq!(first, StatusCode::NO_CONTENT);
    let identical = put_output(
        output_url(&base, ATTEMPT, 0, "a"),
        samples([1.0, 0.5, -0.25, 2.0]),
    )
    .await;
    assert_eq!(identical, StatusCode::NO_CONTENT);
    let changed = put_output(
        output_url(&base, ATTEMPT, 0, "a"),
        samples([9.0, 0.5, -0.25, 2.0]),
    )
    .await;
    assert_eq!(changed, StatusCode::CONFLICT);

    let waiting = units.folded(ATTEMPT, 0);
    let pending = timeout(Duration::from_millis(100), waiting).await;
    assert!(
        pending.is_err(),
        "the changed output must not fold the unit"
    );

    let last = put_output(
        output_url(&base, ATTEMPT, 0, "b"),
        samples([0.0, 0.0, 0.0, 0.0]),
    )
    .await;
    assert_eq!(last, StatusCode::NO_CONTENT);
    timeout(ANSWER, units.folded(ATTEMPT, 0))
        .await
        .expect("the fold should not hang")
        .expect("the unit should fold once every output is ready");
    host.close().await;
}

#[tokio::test]
async fn refuses_an_undeclared_output_and_a_foreign_attempt() {
    let workspace = Workspace::new();
    let (host, units) = start_units(&workspace).await;
    units
        .register(registration(ATTEMPT, &["a"]))
        .expect("the stage should register");
    let base = host.base_url().to_owned();

    let undeclared = put_output(
        output_url(&base, ATTEMPT, 0, "zzz"),
        samples([1.0, 0.5, -0.25, 2.0]),
    )
    .await;
    assert_eq!(undeclared, StatusCode::BAD_REQUEST);
    let outside = put_output(
        output_url(&base, ATTEMPT, 9, "a"),
        samples([1.0, 0.5, -0.25, 2.0]),
    )
    .await;
    assert_eq!(outside, StatusCode::BAD_REQUEST);
    let foreign = put_output(
        output_url(&base, "other", 0, "a"),
        samples([1.0, 0.5, -0.25, 2.0]),
    )
    .await;
    assert_eq!(foreign, StatusCode::CONFLICT);
    host.close().await;
}

#[tokio::test]
async fn refuses_an_output_with_non_finite_samples() {
    let workspace = Workspace::new();
    let (host, units) = start_units(&workspace).await;
    units
        .register(registration(ATTEMPT, &["a"]))
        .expect("the stage should register");
    let base = host.base_url().to_owned();

    let corrupt_body = {
        let mut body = vec![0_u8; EXPECTED];
        body[4..8].copy_from_slice(&f32::NAN.to_le_bytes());
        body
    };
    let corrupt = put_output(output_url(&base, ATTEMPT, 0, "a"), corrupt_body).await;
    assert_eq!(corrupt, StatusCode::BAD_REQUEST);
    let waiting = units.folded(ATTEMPT, 0);
    let pending = timeout(Duration::from_millis(100), waiting).await;
    assert!(pending.is_err(), "a corrupt output must not fold the unit");
    host.close().await;
}

type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn connect_executor(host: &ExecutorHost) -> Socket {
    let page = host.page_url();
    let socket_url = page
        .split_once("jobs=")
        .expect("the page url should carry the socket")
        .1
        .replace("%3A", ":")
        .replace("%2F", "/");
    let (socket, _) = connect_async(socket_url)
        .await
        .expect("the executor should connect");
    socket
}

async fn announce(socket: &mut Socket) {
    let ready = json!({ "type": "ready", "adapter": true, "shaderF16": false });
    socket
        .send(ClientMessage::text(ready.to_string()))
        .await
        .expect("the ready message should be sent");
}

async fn take_command(socket: &mut Socket) -> Value {
    let received = timeout(ANSWER, socket.next())
        .await
        .expect("a command should arrive")
        .expect("the socket should stay open")
        .expect("the command should be readable");
    serde_json::from_str(
        received
            .into_text()
            .expect("the command should be text")
            .as_str(),
    )
    .expect("the command should be json")
}

async fn reply(socket: &mut Socket, message: &Value) {
    socket
        .send(ClientMessage::text(message.to_string()))
        .await
        .expect("the reply should be sent");
}

#[tokio::test]
async fn drives_units_through_the_job_socket() {
    let workspace = Workspace::new();
    let (host, units) = start_units(&workspace).await;
    units
        .register(registration(ATTEMPT, &["a"]))
        .expect("the stage should register");
    let mut socket = connect_executor(&host).await;
    announce(&mut socket).await;
    host.wait_ready()
        .await
        .expect("the executor should be ready");

    let ticket = host
        .send_job("musetricAiSeparateUnits", &Value::Null)
        .expect("the job should start");
    host.send_unit(ATTEMPT, 0, 2)
        .expect("the unit event should be sent");
    let _job = take_command(&mut socket).await;
    let command = take_command(&mut socket).await;

    assert_eq!(command["type"], "unit");
    assert_eq!(command["attemptId"], ATTEMPT);
    assert_eq!(command["unit"], 0);
    assert_eq!(command["unitCount"], 2);
    let job_id = command["jobId"].as_str().expect("the job id").to_owned();
    reply(
        &mut socket,
        &json!({ "type": "unitDone", "jobId": job_id, "attemptId": ATTEMPT, "unit": 0 }),
    )
    .await;
    reply(
        &mut socket,
        &json!({ "type": "result", "jobId": job_id, "result": 1 }),
    )
    .await;

    ticket.wait().await.expect("the job should answer");
    host.close().await;
}

#[tokio::test]
async fn fails_the_job_on_a_done_event_outside_the_plan() {
    let workspace = Workspace::new();
    let (host, units) = start_units(&workspace).await;
    units
        .register(registration(ATTEMPT, &["a"]))
        .expect("the stage should register");
    let mut socket = connect_executor(&host).await;
    announce(&mut socket).await;
    host.wait_ready()
        .await
        .expect("the executor should be ready");

    let ticket = host
        .send_job("musetricAiSeparateUnits", &Value::Null)
        .expect("the job should start");
    host.send_unit(ATTEMPT, 0, 2)
        .expect("the unit event should be sent");
    let command = take_command(&mut socket).await;
    let job_id = command["jobId"].as_str().expect("the job id").to_owned();
    reply(
        &mut socket,
        &json!({ "type": "unitDone", "jobId": job_id, "attemptId": ATTEMPT, "unit": 9 }),
    )
    .await;

    let failure = ticket.wait().await.expect_err("the job should fail");
    assert_eq!(
        failure.to_string(),
        "the done event points outside the plan"
    );
    host.close().await;
}
