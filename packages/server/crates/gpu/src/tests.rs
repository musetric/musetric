use std::{
    collections::HashMap,
    fs::{create_dir_all, read_to_string, remove_dir_all, write},
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

use crate::host::{BoxedError, ExecutorHost, ExecutorHostOptions};

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

    fn target(&self, name: &str) -> PathBuf {
        self.directory.join("uploads").join(name)
    }
}

impl Drop for Workspace {
    fn drop(&mut self) {
        let _ = remove_dir_all(&self.directory);
    }
}

struct Reported {
    progress: Arc<Mutex<Vec<f64>>>,
}

impl Reported {
    fn create() -> Self {
        Self {
            progress: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn sink(&self) -> Arc<dyn Fn(f64) + Send + Sync> {
        let progress = Arc::clone(&self.progress);
        Arc::new(move |value| {
            progress
                .lock()
                .expect("the progress log should be writable")
                .push(value);
        })
    }

    fn seen(&self) -> Vec<f64> {
        self.progress
            .lock()
            .expect("the progress log should be readable")
            .clone()
    }
}

async fn start_host(
    workspace: &Workspace,
    require_shader_f16: bool,
    reported: &Reported,
) -> ExecutorHost {
    ExecutorHost::start(ExecutorHostOptions {
        label: "Fixture analysis".to_owned(),
        bundle_path: workspace.bundle_path(),
        pcm: Bytes::from_static(PCM),
        require_shader_f16,
        on_progress: reported.sink(),
    })
    .await
    .expect("the host should start")
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

async fn put(url: &str, content: &'static str) -> StatusCode {
    let uri: Uri = url.parse().expect("the url should be valid");
    let request = Request::put(uri)
        .body(Body::from(content))
        .expect("the request should build");
    read_response(request).await.0
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
    answered: tokio::task::JoinHandle<Result<Value, BoxedError>>,
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
async fn runs_a_job_and_reports_its_progress() {
    let workspace = Workspace::new();
    let reported = Reported::create();
    let request = json!({ "pcmUrl": "http://127.0.0.1/pcm" });
    let mut job = start_job(&workspace, &reported, true, request).await;
    let job_id = read_job_id(&job.command);

    reply(
        &mut job.executor,
        &json!({ "type": "progress", "jobId": job_id, "progress": 0.5 }),
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
    assert!(
        job.command["uploadUrl"]
            .as_str()
            .is_some_and(|url| url.ends_with("/uploads/"))
    );
    assert_eq!(result, json!({ "segments": 3 }));
    assert_eq!(reported.seen(), vec![0.5]);
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

#[tokio::test]
async fn stores_the_upload_the_analysis_expects() {
    let workspace = Workspace::new();
    let reported = Reported::create();
    let host = start_host(&workspace, false, &reported).await;
    let target = workspace.target("lead.raw");
    let targets = HashMap::from([("lead.raw".to_owned(), target.clone())]);

    let wait = host.expect_uploads(targets).expect("the uploads register");
    let stored = put(&format!("{}/uploads/lead.raw", host.base_url()), "stem").await;

    assert_eq!(stored, StatusCode::NO_CONTENT);
    wait.wait().await.expect("the upload should complete");
    assert_eq!(
        read_to_string(&target).expect("the upload should be stored"),
        "stem"
    );
    host.close().await;
}

#[tokio::test]
async fn refuses_an_upload_the_analysis_did_not_ask_for() {
    let workspace = Workspace::new();
    let reported = Reported::create();
    let host = start_host(&workspace, false, &reported).await;
    let target = workspace.target("lead.raw");
    let targets = HashMap::from([("lead.raw".to_owned(), target.clone())]);

    let wait = host.expect_uploads(targets).expect("the uploads register");
    let refused = put(&format!("{}/uploads/other.raw", host.base_url()), "stem").await;

    assert_eq!(refused, StatusCode::BAD_REQUEST);
    let reported_failure = wait.wait().await.expect_err("the uploads should fail");
    assert_eq!(
        reported_failure.to_string(),
        "Unexpected executor upload: other.raw"
    );
    assert!(!target.exists());
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
    assert_eq!(failure.to_string(), "the gpu executor disconnected");
}
