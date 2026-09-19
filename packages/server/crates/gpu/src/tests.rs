use std::{
    fs::{create_dir_all, remove_dir_all, write},
    path::PathBuf,
    process::id,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::body::{Body, Bytes};
use futures_util::{SinkExt, StreamExt};
use http_body_util::BodyExt;
use hyper::{Request, StatusCode, Uri};
use hyper_util::{
    client::legacy::{Client, connect::HttpConnector},
    rt::TokioExecutor,
};
use serde_json::{Value, json};
use tokio::time::timeout;
use tokio_tungstenite::{connect_async, tungstenite::Message as ClientMessage};

use crate::{
    files::{Asset, Assets, Bundle},
    host::{
        BoxedError, EXECUTOR_LOG, ExecutorFailure, ExecutorHost, ExecutorSession,
        ExecutorSessionOptions, JobTicket, Liveness, PhaseSink,
    },
    protocol::{ExecutorPass, ExecutorPhase},
    units::{UnitCompleted, UnitReject, UnitSession, UnitTarget},
};

static WORKSPACE_COUNT: AtomicUsize = AtomicUsize::new(0);

const BUNDLE_ASSET: &str = "console.log('bundle');\n";
const API: &str = "musetricAiAnalyzeFixture";
const ANSWER: Duration = Duration::from_secs(5);

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
            std::env::temp_dir().join(format!("musetric-gpu-{}-{stamp}-{ordinal}", id()));
        create_dir_all(directory.join("bundle")).expect("the workspace should be created");
        write(directory.join("bundle").join("index.js"), BUNDLE_ASSET)
            .expect("the bundle asset should be written");
        create_dir_all(directory.join("bundle").join("assets"))
            .expect("the hashed asset folder should be created");
        write(
            directory
                .join("bundle")
                .join("assets")
                .join("runtime-Cx9aB2.wasm"),
            BUNDLE_ASSET,
        )
        .expect("the hashed asset should be written");
        Self { directory }
    }

    fn bundle_path(&self) -> PathBuf {
        self.directory.join("bundle")
    }

    fn file(&self, name: &str, content: &str) -> PathBuf {
        let path = self.directory.join(name);
        write(&path, content).expect("the file should be written");
        path
    }

    fn nested(&self, name: &str, content: &str) -> PathBuf {
        let root = self.directory.join("cache");
        let path = root.join(name);
        create_dir_all(path.parent().expect("the nested file should have a parent"))
            .expect("the nested directory should be created");
        write(&path, content).expect("the nested file should be written");
        root
    }
}

impl Drop for Workspace {
    fn drop(&mut self) {
        let _ = remove_dir_all(&self.directory);
    }
}

struct Reported {
    phases: Arc<Mutex<Vec<ExecutorPhase>>>,
}

impl Reported {
    fn create() -> Self {
        Self {
            phases: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn sink(&self) -> PhaseSink {
        let phases = Arc::clone(&self.phases);
        Arc::new(move |phase| {
            phases
                .lock()
                .expect("the phase log should be writable")
                .push(phase);
        })
    }

    fn seen(&self) -> Vec<ExecutorPhase> {
        self.phases
            .lock()
            .expect("the phase log should be readable")
            .clone()
    }
}

struct Hosted {
    host: Arc<ExecutorHost>,
    session: ExecutorSession,
}

impl Hosted {
    fn base_url(&self) -> &str {
        self.host.base_url()
    }

    fn socket_url(&self) -> String {
        self.host.socket_url()
    }

    async fn wait_ready(&self) -> Result<(), ExecutorFailure> {
        self.session.wait_ready().await
    }

    async fn register_file(&self, path: &std::path::Path) -> Result<String, BoxedError> {
        self.session.register_file(path).await
    }

    async fn register_directory(&self, path: &std::path::Path) -> Result<String, BoxedError> {
        self.session.register_directory(path).await
    }

    async fn run(&self, api: &str, request: &Value) -> Result<Value, ExecutorFailure> {
        self.session.run(api, request).await
    }

    fn send_job(&self, api: &str, request: &Value) -> Result<JobTicket, ExecutorFailure> {
        self.session.send_job(api, request)
    }

    fn send_unit(
        &self,
        attempt_id: &str,
        unit: u32,
        unit_count: u32,
    ) -> Result<(), ExecutorFailure> {
        self.session.send_unit(attempt_id, unit, unit_count)
    }

    async fn close(self) {
        self.host.close().await;
    }
}

async fn start_host(
    workspace: &Workspace,
    require_shader_f16: bool,
    reported: &Reported,
) -> Hosted {
    start_session(workspace, require_shader_f16, reported, None).await
}

fn open_session(host: &Arc<ExecutorHost>, reported: &Reported) -> ExecutorSession {
    host.open(ExecutorSessionOptions {
        label: "Fixture analysis".to_owned(),
        require_shader_f16: false,
        on_phase: reported.sink(),
        units: None,
    })
}

async fn start_session(
    workspace: &Workspace,
    require_shader_f16: bool,
    reported: &Reported,
    units: Option<Arc<dyn UnitSession>>,
) -> Hosted {
    let host = ExecutorHost::start(Bundle::Directory(workspace.bundle_path()))
        .await
        .expect("the host should start");
    let session = host.open(ExecutorSessionOptions {
        label: "Fixture analysis".to_owned(),
        require_shader_f16,
        on_phase: reported.sink(),
        units,
    });
    Hosted { host, session }
}

async fn ready_units(
    workspace: &Workspace,
    reported: &Reported,
    units: &Arc<CountedUnits>,
) -> (Hosted, Executor) {
    let host = start_session(
        workspace,
        false,
        reported,
        Some(Arc::clone(units) as Arc<dyn UnitSession>),
    )
    .await;
    let mut executor = connect_executor(&host).await;
    announce(&mut executor, true, false).await;
    host.wait_ready()
        .await
        .expect("the executor should be ready");
    (host, executor)
}

fn create_client() -> Client<HttpConnector, Body> {
    Client::builder(TokioExecutor::new()).build(HttpConnector::new())
}

async fn read_response(request: Request<Body>) -> (StatusCode, Vec<u8>) {
    let response = create_client()
        .request(request)
        .await
        .expect("the host should answer");
    let status = response.status();
    let collected = response
        .into_body()
        .collect()
        .await
        .expect("the body should be read");
    (status, collected.to_bytes().to_vec())
}

async fn read_cache_control(url: &str) -> String {
    let uri: Uri = url.parse().expect("the url should be valid");
    let request = Request::get(uri)
        .body(Body::empty())
        .expect("the request should build");
    let response = create_client()
        .request(request)
        .await
        .expect("the host should answer");
    response
        .headers()
        .get("cache-control")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_owned()
}

async fn get(url: &str) -> (StatusCode, Vec<u8>) {
    let uri: Uri = url.parse().expect("the url should be valid");
    let request = Request::get(uri)
        .body(Body::empty())
        .expect("the request should build");
    read_response(request).await
}

type Executor =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn connect_executor(host: &Hosted) -> Executor {
    connect_socket(&host.socket_url()).await
}

async fn connect_socket(socket_url: &str) -> Executor {
    let (socket, _) = connect_async(socket_url)
        .await
        .expect("the executor should connect");
    socket
}

async fn announce(socket: &mut Executor, adapter: bool, shader_f16: bool) {
    let ready = json!({ "type": "ready", "adapter": adapter, "shaderF16": shader_f16 });
    socket
        .send(ClientMessage::text(ready.to_string()))
        .await
        .expect("the ready message should be sent");
}

async fn take_command(socket: &mut Executor) -> Value {
    let received = timeout(ANSWER, socket.next())
        .await
        .expect("a command should arrive")
        .expect("the socket should stay open")
        .expect("the command should be readable");
    let text = received.into_text().expect("the command should be text");
    serde_json::from_str(text.as_str()).expect("the command should be json")
}

async fn reply(socket: &mut Executor, message: &Value) {
    socket
        .send(ClientMessage::text(message.to_string()))
        .await
        .expect("the reply should be sent");
}

struct RunningJob {
    executor: Executor,
    answered: tokio::task::JoinHandle<Result<Value, ExecutorFailure>>,
    command: Value,
}

async fn start_job(
    workspace: &Workspace,
    reported: &Reported,
    require_shader_f16: bool,
    request: Value,
) -> RunningJob {
    let host = start_host(workspace, require_shader_f16, reported).await;
    let mut executor = connect_executor(&host).await;
    announce(&mut executor, true, require_shader_f16).await;
    host.wait_ready()
        .await
        .expect("the executor should be ready");
    let answered = tokio::spawn(async move { host.run(API, &request).await });
    let command = take_command(&mut executor).await;
    RunningJob {
        executor,
        answered,
        command,
    }
}

fn read_job_id(command: &Value) -> String {
    command["jobId"]
        .as_str()
        .expect("the command should carry a job id")
        .to_owned()
}

#[tokio::test]
async fn serves_the_page_the_bundle_and_the_registered_files() {
    let workspace = Workspace::new();
    let reported = Reported::create();
    let host = start_host(&workspace, false, &reported).await;
    let registered = workspace.file("model.onnx", "fixture model");

    let file_url = host
        .register_file(&registered)
        .await
        .expect("the file should register");
    let (page_status, page) = get(&format!("{}/", host.base_url())).await;
    let page_cache = read_cache_control(&format!("{}/", host.base_url())).await;
    let (file_status, file) = get(&file_url).await;
    let (asset_status, asset) = get(&format!("{}/index.js", host.base_url())).await;
    let (missing_status, _) = get(&format!("{}/nothing.js", host.base_url())).await;
    let entry_cache = read_cache_control(&format!("{}/index.js", host.base_url())).await;
    let hashed_cache =
        read_cache_control(&format!("{}/assets/runtime-Cx9aB2.wasm", host.base_url())).await;

    assert_eq!(page_status, StatusCode::OK);
    assert!(String::from_utf8_lossy(&page).contains("/index.js"));
    assert_eq!(page_cache, "no-store");
    assert_eq!(file_status, StatusCode::OK);
    assert_eq!(String::from_utf8_lossy(&file), "fixture model");
    assert!(file_url.ends_with("/model.onnx"));
    assert_eq!(asset_status, StatusCode::OK);
    assert_eq!(String::from_utf8_lossy(&asset), BUNDLE_ASSET);
    assert_eq!(missing_status, StatusCode::NOT_FOUND);
    assert_eq!(entry_cache, "no-store");
    assert_eq!(hashed_cache, "public, max-age=31536000, immutable");
    host.close().await;
}

async fn finish_job(socket: &mut Executor, result: Value) -> Value {
    let command = take_command(socket).await;
    reply(
        socket,
        &json!({ "type": "result", "jobId": read_job_id(&command), "result": result }),
    )
    .await;
    command
}

#[tokio::test]
async fn serves_a_second_session_over_the_same_connection() {
    let workspace = Workspace::new();
    let reported = Reported::create();
    let host = ExecutorHost::start(Bundle::Directory(workspace.bundle_path()))
        .await
        .expect("the host should start");
    let mut executor = connect_socket(&host.socket_url()).await;
    announce(&mut executor, true, false).await;

    let first = open_session(&host, &reported);
    let file_url = first
        .register_file(&workspace.file("model.onnx", "fixture model"))
        .await
        .expect("the file should register");
    first.wait_ready().await.expect("the first should be ready");
    let opening = first
        .send_job(API, &Value::Null)
        .expect("the first job should start");
    finish_job(&mut executor, json!(1)).await;
    opening.wait().await.expect("the first job should answer");
    drop(first);

    let second = open_session(&host, &reported);
    second
        .wait_ready()
        .await
        .expect("the second should be ready");
    let ticket = second
        .send_job(API, &Value::Null)
        .expect("the second job should start");
    let command = finish_job(&mut executor, json!(2)).await;

    assert_eq!(command["type"], "job");
    let (stale, _) = get(&file_url).await;
    assert_eq!(stale, StatusCode::NOT_FOUND);
    ticket.wait().await.expect("the second job should answer");
    host.close().await;
}

#[tokio::test]
async fn tells_whether_an_executor_is_ready_and_when_one_arrives() {
    let workspace = Workspace::new();
    let host = ExecutorHost::start(Bundle::Directory(workspace.bundle_path()))
        .await
        .expect("the host should start");
    let mut arrivals = host.arrivals();
    let before = host.has_executor();

    let mut executor = connect_socket(&host.socket_url()).await;
    let connected_only = host.has_executor();
    announce(&mut executor, true, false).await;
    let arrived = timeout(ANSWER, arrivals.next())
        .await
        .expect("the arrival should be announced");
    let after_ready = host.has_executor();
    executor.close(None).await.expect("the socket should close");
    let gone = timeout(ANSWER, async {
        while host.has_executor() {
            tokio::task::yield_now().await;
        }
    })
    .await;

    assert!(!before);
    assert!(!connected_only);
    assert!(arrived);
    assert!(after_ready);
    assert!(gone.is_ok());
    host.close().await;
}

#[tokio::test]
async fn drops_an_executor_that_stops_answering_the_host() {
    let workspace = Workspace::new();
    let reported = Reported::create();
    let host = ExecutorHost::start_with(
        Bundle::Directory(workspace.bundle_path()),
        Liveness {
            ping: Duration::from_millis(20),
            silence: Duration::from_millis(120),
        },
    )
    .await
    .expect("the host should start");
    let mut executor = connect_socket(&host.socket_url()).await;
    announce(&mut executor, true, false).await;
    let session = open_session(&host, &reported);
    session
        .wait_ready()
        .await
        .expect("the host should be ready");
    let ticket = session
        .send_job(API, &Value::Null)
        .expect("the job should start");
    let command = take_command(&mut executor).await;

    let silent = timeout(ANSWER, ticket.wait())
        .await
        .expect("the job should not hang")
        .expect_err("the job should fail");

    assert_eq!(command["type"], "job");
    assert!(matches!(silent, ExecutorFailure::Lost));
    host.close().await;
}

#[tokio::test]
async fn hands_the_lease_to_the_next_executor_when_the_leader_drops() {
    let workspace = Workspace::new();
    let reported = Reported::create();
    let host = ExecutorHost::start(Bundle::Directory(workspace.bundle_path()))
        .await
        .expect("the host should start");
    let mut leading = connect_socket(&host.socket_url()).await;
    announce(&mut leading, true, false).await;
    let first = open_session(&host, &reported);
    first
        .wait_ready()
        .await
        .expect("the leader should be ready");
    let mut standby = connect_socket(&host.socket_url()).await;
    announce(&mut standby, true, false).await;
    let ticket = first
        .send_job(API, &Value::Null)
        .expect("the leading job should start");
    let leading_command = take_command(&mut leading).await;

    leading
        .close(None)
        .await
        .expect("the leading socket should close");
    let failure = timeout(ANSWER, ticket.wait())
        .await
        .expect("the job should not hang")
        .expect_err("the job should fail");
    drop(first);
    let second = open_session(&host, &reported);
    second
        .wait_ready()
        .await
        .expect("the standby should take the lease");
    let handed = second
        .send_job(API, &Value::Null)
        .expect("the handed job should start");
    let standby_command = finish_job(&mut standby, json!(3)).await;

    assert_eq!(leading_command["type"], "job");
    assert!(matches!(failure, ExecutorFailure::Lost));
    assert_eq!(standby_command["type"], "job");
    handed.wait().await.expect("the handed job should answer");
    host.close().await;
}

#[tokio::test]
async fn serves_a_whole_registered_directory() {
    let workspace = Workspace::new();
    let reported = Reported::create();
    let host = start_host(&workspace, false, &reported).await;
    let root = workspace.nested("model/resolve/main/config.json", "{}");

    let directory_url = host
        .register_directory(&root)
        .await
        .expect("the directory should register");
    let (found_status, found) =
        get(&format!("{directory_url}/model/resolve/main/config.json")).await;
    let (missing_status, _) = get(&format!("{directory_url}/model/resolve/main/other.json")).await;
    let (escaped_status, _) = get(&format!("{directory_url}/%2e%2e/bundle/index.js")).await;

    assert_eq!(found_status, StatusCode::OK);
    assert_eq!(String::from_utf8_lossy(&found), "{}");
    assert_eq!(missing_status, StatusCode::NOT_FOUND);
    assert_eq!(escaped_status, StatusCode::NOT_FOUND);
    host.close().await;
}

#[tokio::test]
async fn runs_a_job_and_reports_its_phases() {
    let workspace = Workspace::new();
    let reported = Reported::create();
    let request = json!({ "pcmUrl": "http://127.0.0.1/pcm" });
    let mut job = start_job(&workspace, &reported, true, request).await;
    let job_id = read_job_id(&job.command);

    reply(
        &mut job.executor,
        &json!({ "type": "loading", "jobId": job_id }),
    )
    .await;
    reply(
        &mut job.executor,
        &json!({
            "type": "running",
            "jobId": job_id,
            "pass": "decode",
            "unit": 1,
            "unitCount": 4,
        }),
    )
    .await;
    reply(
        &mut job.executor,
        &json!({ "type": "result", "jobId": job_id, "result": { "segments": 3 } }),
    )
    .await;

    let result = job
        .answered
        .await
        .expect("the job task should finish")
        .expect("the job should answer");
    assert_eq!(job.command["type"], "job");
    assert_eq!(job.command["api"], API);
    assert_eq!(job.command["request"]["pcmUrl"], "http://127.0.0.1/pcm");
    assert_eq!(result, json!({ "segments": 3 }));
    assert_eq!(
        reported.seen(),
        vec![
            ExecutorPhase::Loading,
            ExecutorPhase::Running {
                pass: ExecutorPass::Decode,
                unit: 1,
                unit_count: 4,
            }
        ]
    );
}

#[tokio::test]
async fn refuses_an_adapter_without_the_required_shader_f16() {
    let workspace = Workspace::new();
    let reported = Reported::create();
    let host = start_host(&workspace, true, &reported).await;
    let mut executor = connect_executor(&host).await;

    announce(&mut executor, true, false).await;

    let refused = host.wait_ready().await.expect_err("the host should refuse");
    assert_eq!(
        refused.to_string(),
        "Fixture analysis adapter does not support required shader-f16"
    );
    host.close().await;
}

#[tokio::test]
async fn fails_a_job_the_executor_could_not_finish() {
    let workspace = Workspace::new();
    let reported = Reported::create();
    let mut job = start_job(&workspace, &reported, false, Value::Null).await;
    let job_id = read_job_id(&job.command);

    reply(
        &mut job.executor,
        &json!({ "type": "failed", "jobId": job_id, "error": "the model did not load" }),
    )
    .await;

    let failure = job
        .answered
        .await
        .expect("the job task should finish")
        .expect_err("the job should fail");
    assert_eq!(failure.to_string(), "the model did not load");
}

struct EchoedAssets;

impl Assets for EchoedAssets {
    fn get(&self, path: &str) -> Option<Asset> {
        Some(Asset::create(
            path.as_bytes().to_vec(),
            "text/javascript".to_owned(),
        ))
    }
}

#[tokio::test]
async fn asks_an_embedder_for_the_bundle_only_by_a_relative_name() {
    let reported = Reported::create();
    let _unused = reported.sink();
    let host = ExecutorHost::start(Bundle::Assets(Arc::new(EchoedAssets)))
        .await
        .expect("the host should start");

    let (status, asked) = get(&format!("{}/assets/index.js", host.base_url())).await;
    let (encoded, _) = get(&format!("{}/%2e%2e/secret", host.base_url())).await;
    let (escaped, _) = get(&format!("{}/../secret", host.base_url())).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(String::from_utf8_lossy(&asked), "assets/index.js");
    assert_eq!(encoded, StatusCode::NOT_FOUND);
    assert_eq!(escaped, StatusCode::NOT_FOUND);
    host.close().await;
}

#[tokio::test]
async fn fails_a_running_job_when_the_executor_disappears() {
    let workspace = Workspace::new();
    let reported = Reported::create();
    let mut job = start_job(&workspace, &reported, false, Value::Null).await;

    job.executor
        .close(None)
        .await
        .expect("the socket should close");

    let failure = timeout(ANSWER, job.answered)
        .await
        .expect("the job should not hang")
        .expect("the job task should finish")
        .expect_err("the job should fail");
    assert!(matches!(failure, ExecutorFailure::Lost));
}

struct CountedUnits {
    done: Mutex<Vec<(String, u32)>>,
}

impl CountedUnits {
    fn create() -> Arc<Self> {
        Arc::new(Self {
            done: Mutex::new(Vec::new()),
        })
    }

    fn seen(&self) -> Vec<(String, u32)> {
        self.done
            .lock()
            .expect("the log should be readable")
            .clone()
    }
}

impl UnitSession for CountedUnits {
    fn window(&self, _attempt: &str, _unit: u32) -> Result<Bytes, UnitReject> {
        Ok(Bytes::new())
    }

    fn target(&self, _attempt: &str, _unit: u32, _output: &str) -> Result<UnitTarget, UnitReject> {
        Ok(UnitTarget::Confirm)
    }

    fn completed<'a>(
        &'a self,
        _attempt: &'a str,
        _unit: u32,
        _output: &'a str,
    ) -> UnitCompleted<'a> {
        Box::pin(async { Ok(()) })
    }

    fn aborted(&self, _attempt: &str, _unit: u32, _output: &str) {}

    fn opened(&self, _attempt: &str) -> Result<(), String> {
        Ok(())
    }

    fn done(&self, attempt: &str, unit: u32) -> Result<(), String> {
        if unit >= 4 {
            return Err("the done event points outside the plan".to_owned());
        }
        self.done
            .lock()
            .expect("the log should be writable")
            .push((attempt.to_owned(), unit));
        Ok(())
    }
}

#[tokio::test]
async fn drives_units_over_the_job_socket() {
    let workspace = Workspace::new();
    let reported = Reported::create();
    let units = CountedUnits::create();
    let (host, mut executor) = ready_units(&workspace, &reported, &units).await;

    let ticket = host
        .send_job(API, &json!({ "pcmUrl": "http://127.0.0.1/pcm" }))
        .expect("the job should start");
    host.send_unit("attempt-1", 3, 7)
        .expect("the unit event should be sent");
    let _job_command = take_command(&mut executor).await;
    let command = take_command(&mut executor).await;

    assert_eq!(command["type"], "unit");
    assert_eq!(command["attemptId"], "attempt-1");
    assert_eq!(command["unit"], 3);
    assert_eq!(command["unitCount"], 7);
    let job_id = read_job_id(&command);
    reply(
        &mut executor,
        &json!({ "type": "unitDone", "jobId": job_id, "attemptId": "attempt-1", "unit": 3 }),
    )
    .await;
    reply(
        &mut executor,
        &json!({ "type": "result", "jobId": job_id, "result": 1 }),
    )
    .await;

    ticket.wait().await.expect("the job should answer");
    assert_eq!(units.seen(), vec![("attempt-1".to_owned(), 3)]);
    host.close().await;
}

#[tokio::test]
async fn fails_the_job_when_a_done_event_points_outside_the_plan() {
    let workspace = Workspace::new();
    let reported = Reported::create();
    let units = CountedUnits::create();
    let (host, mut executor) = ready_units(&workspace, &reported, &units).await;

    let ticket = host
        .send_job(API, &Value::Null)
        .expect("the job should start");
    host.send_unit("attempt-1", 0, 4)
        .expect("the unit event should be sent");
    let _job_command = take_command(&mut executor).await;
    let command = take_command(&mut executor).await;
    let job_id = read_job_id(&command);
    reply(
        &mut executor,
        &json!({ "type": "unitDone", "jobId": job_id, "attemptId": "attempt-1", "unit": 9 }),
    )
    .await;

    let failure = ticket.wait().await.expect_err("the job should fail");
    assert_eq!(
        failure.to_string(),
        "the done event points outside the plan"
    );
    host.close().await;
}

struct CapturedLog;

static CAPTURED: Mutex<Vec<(log::Level, String)>> = Mutex::new(Vec::new());
static CAPTURE: CapturedLog = CapturedLog;

impl log::Log for CapturedLog {
    fn enabled(&self, metadata: &log::Metadata<'_>) -> bool {
        metadata.target() == EXECUTOR_LOG
    }

    fn log(&self, record: &log::Record<'_>) {
        if self.enabled(record.metadata())
            && let Ok(mut lines) = CAPTURED.lock()
        {
            lines.push((record.level(), record.args().to_string()));
        }
    }

    fn flush(&self) {}
}

fn captured() -> Vec<(log::Level, String)> {
    CAPTURED
        .lock()
        .map(|lines| lines.clone())
        .unwrap_or_default()
}

#[tokio::test]
async fn writes_executor_log_lines_to_the_host_log() {
    let _ = log::set_logger(&CAPTURE);
    log::set_max_level(log::LevelFilter::Warn);
    let workspace = Workspace::new();
    let reported = Reported::create();
    let host = start_host(&workspace, false, &reported).await;
    let mut executor = connect_executor(&host).await;

    reply(
        &mut executor,
        &json!({ "type": "log", "level": "error", "message": "the runtime threw 31203688" }),
    )
    .await;
    reply(
        &mut executor,
        &json!({ "type": "log", "level": "info", "message": "not a level the executor sends" }),
    )
    .await;
    reply(
        &mut executor,
        &json!({ "type": "log", "level": "warn", "message": "the adapter lost its device" }),
    )
    .await;
    for _ in 0..200 {
        if captured().len() >= 2 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    host.close().await;

    assert_eq!(
        captured(),
        vec![
            (log::Level::Error, "the runtime threw 31203688".to_owned()),
            (log::Level::Warn, "the adapter lost its device".to_owned()),
        ]
    );
}
