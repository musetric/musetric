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
    host::{ExecutorFailure, ExecutorHost, ExecutorHostOptions, PhaseSink},
    protocol::{ExecutorPass, ExecutorPhase},
    units::{UnitCompleted, UnitReject, UnitSession, UnitTarget},
};

static WORKSPACE_COUNT: AtomicUsize = AtomicUsize::new(0);

const PCM: &[u8] = b"fixture pcm bytes";
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

async fn start_host(
    workspace: &Workspace,
    require_shader_f16: bool,
    reported: &Reported,
) -> ExecutorHost {
    start_session(workspace, require_shader_f16, reported, None).await
}

async fn start_session(
    workspace: &Workspace,
    require_shader_f16: bool,
    reported: &Reported,
    units: Option<Arc<dyn UnitSession>>,
) -> ExecutorHost {
    ExecutorHost::start(ExecutorHostOptions {
        label: "Fixture analysis".to_owned(),
        bundle: Bundle::Directory(workspace.bundle_path()),
        pcm: Bytes::from_static(PCM),
        require_shader_f16,
        on_phase: reported.sink(),
        units,
    })
    .await
    .expect("the host should start")
}

async fn ready_units(
    workspace: &Workspace,
    reported: &Reported,
    units: &Arc<CountedUnits>,
) -> (ExecutorHost, Executor) {
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

async fn get(url: &str) -> (StatusCode, Vec<u8>) {
    let uri: Uri = url.parse().expect("the url should be valid");
    let request = Request::get(uri)
        .body(Body::empty())
        .expect("the request should build");
    read_response(request).await
}

type Executor =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn connect_executor(host: &ExecutorHost) -> Executor {
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
async fn serves_the_page_the_pcm_and_the_registered_files() {
    let workspace = Workspace::new();
    let reported = Reported::create();
    let host = start_host(&workspace, false, &reported).await;
    let registered = workspace.file("model.onnx", "fixture model");

    let file_url = host
        .register_file(&registered)
        .await
        .expect("the file should register");
    let (page_status, page) = get(&host.page_url()).await;
    let (pcm_status, pcm) = get(&host.pcm_url()).await;
    let (file_status, file) = get(&file_url).await;
    let (asset_status, asset) = get(&format!("{}/index.js", host.base_url())).await;
    let (missing_status, _) = get(&format!("{}/nothing.js", host.base_url())).await;

    assert_eq!(page_status, StatusCode::OK);
    assert!(String::from_utf8_lossy(&page).contains("/index.js"));
    assert!(host.page_url().contains("jobs=ws%3A%2F%2F"));
    assert_eq!(pcm_status, StatusCode::OK);
    assert_eq!(pcm, PCM);
    assert_eq!(file_status, StatusCode::OK);
    assert_eq!(String::from_utf8_lossy(&file), "fixture model");
    assert!(file_url.ends_with("/model.onnx"));
    assert_eq!(asset_status, StatusCode::OK);
    assert_eq!(String::from_utf8_lossy(&asset), BUNDLE_ASSET);
    assert_eq!(missing_status, StatusCode::NOT_FOUND);
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
    let host = ExecutorHost::start(ExecutorHostOptions {
        label: "Fixture analysis".to_owned(),
        bundle: Bundle::Assets(Arc::new(EchoedAssets)),
        pcm: Bytes::from_static(PCM),
        require_shader_f16: false,
        on_phase: reported.sink(),
        units: None,
    })
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
    assert!(matches!(failure, ExecutorFailure::Unavailable));
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
