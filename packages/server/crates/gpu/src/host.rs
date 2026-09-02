use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    Router,
    body::{Body, Bytes},
    extract::{Request, State, WebSocketUpgrade, ws::Message, ws::WebSocket},
    http::{HeaderValue, StatusCode, header::CONTENT_TYPE},
    response::{IntoResponse, Response},
    routing::{any, get},
};
use serde_json::Value;
use tokio::{
    net::TcpListener,
    sync::{Notify, mpsc, oneshot},
    task::JoinHandle,
    time::timeout,
};
use uuid::Uuid;

use crate::{
    files::{LOADER_HTML, NO_STORE, OCTET_STREAM, read_content_type, resolve_asset, send_file},
    protocol::{
        ExecutorMessage, JOB_SOCKET_PATH, JOB_URL_PARAMETER, UPLOAD_ROUTE, read_executor_message,
        write_job_command,
    },
    upload::{PendingUpload, UploadWait, receive_upload},
};

pub type BoxedError = Box<dyn std::error::Error + Send + Sync>;

const READY_TIMEOUT: Duration = Duration::from_secs(30);
const HTML: &str = "text/html; charset=utf-8";
const PCM_ROUTE: &str = "/pcm";
const FILES_ROUTE: &str = "/files/";
const MODELS_ROUTE: &str = "/models/";
const DISCONNECTED: &str = "the gpu executor disconnected";

pub type ProgressSink = Arc<dyn Fn(f64) + Send + Sync>;

pub struct ExecutorHostOptions {
    pub label: String,
    pub bundle_path: PathBuf,
    pub pcm: Bytes,
    pub require_shader_f16: bool,
    pub on_progress: ProgressSink,
}

pub(crate) struct HostState {
    label: String,
    bundle_path: PathBuf,
    pcm: Bytes,
    require_shader_f16: bool,
    on_progress: ProgressSink,
    files: Mutex<HashMap<String, PathBuf>>,
    directories: Mutex<HashMap<String, PathBuf>>,
    uploads: Mutex<Vec<PendingUpload>>,
    jobs: Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>,
    ready: Mutex<Option<oneshot::Sender<Result<(), String>>>>,
    outgoing: Mutex<Option<mpsc::UnboundedSender<Message>>>,
    closing: Notify,
}

impl HostState {
    fn accept(&self, message: &str) {
        let Some(read) = read_executor_message(message) else {
            return;
        };
        match read {
            ExecutorMessage::Ready {
                adapter,
                shader_f16,
            } => self.report_ready(adapter, shader_f16),
            ExecutorMessage::Progress { progress } => (self.on_progress)(progress),
            ExecutorMessage::Answer { job_id, result } => self.answer(&job_id, Ok(result)),
            ExecutorMessage::Failure { job_id, error } => self.answer(&job_id, Err(error)),
        }
    }

    fn report_ready(&self, adapter: bool, shader_f16: bool) {
        let outcome = if adapter {
            if self.require_shader_f16 && !shader_f16 {
                Err(format!(
                    "{} adapter does not support required shader-f16",
                    self.label
                ))
            } else {
                Ok(())
            }
        } else {
            Err(format!("{} could not get a WebGPU adapter", self.label))
        };
        if let Ok(mut ready) = self.ready.lock()
            && let Some(sender) = ready.take()
        {
            let _ = sender.send(outcome);
        }
    }

    fn answer(&self, job_id: &str, result: Result<Value, String>) {
        let taken = self
            .jobs
            .lock()
            .ok()
            .and_then(|mut jobs| jobs.remove(job_id));
        if let Some(sender) = taken {
            let _ = sender.send(result);
        }
    }

    pub(crate) fn refuse_uploads(&self, name: &str) {
        let Ok(mut uploads) = self.uploads.lock() else {
            return;
        };
        for upload in uploads.iter_mut() {
            upload.refuse(&format!("Unexpected executor upload: {name}"));
        }
    }

    pub(crate) fn take_upload_target(&self, name: &str) -> Option<PathBuf> {
        let uploads = self.uploads.lock().ok()?;
        uploads.iter().find_map(|upload| upload.target(name))
    }

    pub(crate) fn complete_upload(&self, name: &str) {
        let Ok(mut uploads) = self.uploads.lock() else {
            return;
        };
        for upload in uploads.iter_mut() {
            upload.complete(name);
        }
    }

    fn attach(&self, outgoing: mpsc::UnboundedSender<Message>) {
        if let Ok(mut stored) = self.outgoing.lock() {
            *stored = Some(outgoing);
        }
    }

    fn disconnect(&self) {
        if let Ok(mut stored) = self.outgoing.lock() {
            *stored = None;
        }
        if let Ok(mut ready) = self.ready.lock()
            && let Some(sender) = ready.take()
        {
            let _ = sender.send(Err(format!("{} {DISCONNECTED}", self.label)));
        }
        if let Ok(mut jobs) = self.jobs.lock() {
            for (_, sender) in jobs.drain() {
                let _ = sender.send(Err(DISCONNECTED.to_owned()));
            }
        }
        if let Ok(mut uploads) = self.uploads.lock() {
            for upload in uploads.iter_mut() {
                upload.refuse(DISCONNECTED);
            }
        }
    }

    fn send(&self, message: Message) -> Result<(), BoxedError> {
        let stored = self.outgoing.lock().map_err(|_| "the host is poisoned")?;
        let outgoing = stored.as_ref().ok_or(DISCONNECTED)?;
        outgoing.send(message).map_err(|_| DISCONNECTED)?;
        Ok(())
    }
}

pub struct ExecutorHost {
    state: Arc<HostState>,
    base_url: String,
    ready: Mutex<Option<oneshot::Receiver<Result<(), String>>>>,
    shutdown: Option<oneshot::Sender<()>>,
    served: JoinHandle<()>,
}

impl ExecutorHost {
    pub async fn start(options: ExecutorHostOptions) -> Result<Self, BoxedError> {
        let (ready_sender, ready_receiver) = oneshot::channel();
        let state = Arc::new(HostState {
            label: options.label,
            bundle_path: options.bundle_path,
            pcm: options.pcm,
            require_shader_f16: options.require_shader_f16,
            on_progress: options.on_progress,
            files: Mutex::new(HashMap::new()),
            directories: Mutex::new(HashMap::new()),
            uploads: Mutex::new(Vec::new()),
            jobs: Mutex::new(HashMap::new()),
            ready: Mutex::new(Some(ready_sender)),
            outgoing: Mutex::new(None),
            closing: Notify::new(),
        });
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let base_url = format!("http://{}", listener.local_addr()?);
        let application = create_router(Arc::clone(&state));
        let (shutdown, stopped) = oneshot::channel();
        let served = tokio::spawn(async move {
            let _ = axum::serve(listener, application)
                .with_graceful_shutdown(async move {
                    let _ = stopped.await;
                })
                .await;
        });
        Ok(Self {
            state,
            base_url,
            ready: Mutex::new(Some(ready_receiver)),
            shutdown: Some(shutdown),
            served,
        })
    }

    #[must_use]
    pub fn page_url(&self) -> String {
        let socket_url = format!(
            "{}{JOB_SOCKET_PATH}",
            self.base_url.replace("http://", "ws://")
        );
        format!(
            "{}/?{JOB_URL_PARAMETER}={}",
            self.base_url,
            encode_query_value(&socket_url)
        )
    }

    #[must_use]
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    #[must_use]
    pub fn pcm_url(&self) -> String {
        format!("{}{PCM_ROUTE}", self.base_url)
    }

    pub async fn register_file(&self, path: &Path) -> Result<String, BoxedError> {
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or("a registered file needs a name")?
            .to_owned();
        if !tokio::fs::metadata(path)
            .await
            .is_ok_and(|stat| stat.is_file())
        {
            return Err(
                format!("{} file not found at {}", self.state.label, path.display()).into(),
            );
        }
        let token = Uuid::new_v4().to_string();
        self.state
            .files
            .lock()
            .map_err(|_| "the host is poisoned")?
            .insert(token.clone(), path.to_path_buf());
        Ok(format!("{}{FILES_ROUTE}{token}/{name}", self.base_url))
    }

    pub async fn register_directory(&self, path: &Path) -> Result<String, BoxedError> {
        if !tokio::fs::metadata(path)
            .await
            .is_ok_and(|stat| stat.is_dir())
        {
            return Err(format!(
                "{} directory not found at {}",
                self.state.label,
                path.display()
            )
            .into());
        }
        let token = Uuid::new_v4().to_string();
        self.state
            .directories
            .lock()
            .map_err(|_| "the host is poisoned")?
            .insert(token.clone(), path.to_path_buf());
        Ok(format!("{}{MODELS_ROUTE}{token}", self.base_url))
    }

    pub async fn wait_ready(&self) -> Result<(), BoxedError> {
        let receiver = self
            .ready
            .lock()
            .map_err(|_| "the host is poisoned")?
            .take()
            .ok_or("the gpu executor was already awaited")?;
        let waited = timeout(READY_TIMEOUT, receiver).await;
        let Ok(answered) = waited else {
            return Err(format!("{} executor did not connect in time", self.state.label).into());
        };
        answered.map_err(|_| DISCONNECTED)??;
        Ok(())
    }

    pub async fn run(&self, api: &str, request: &Value) -> Result<Value, BoxedError> {
        let job_id = Uuid::new_v4().to_string();
        let (sender, receiver) = oneshot::channel();
        self.state
            .jobs
            .lock()
            .map_err(|_| "the host is poisoned")?
            .insert(job_id.clone(), sender);
        let upload_url = format!("{}{UPLOAD_ROUTE}", self.base_url);
        let command = write_job_command(&job_id, api, &upload_url, request);
        self.state.send(Message::Text(command.into()))?;
        let answered = receiver.await.map_err(|_| DISCONNECTED)?;
        Ok(answered?)
    }

    pub fn expect_uploads(
        &self,
        targets: HashMap<String, PathBuf>,
    ) -> Result<UploadWait, BoxedError> {
        let (upload, wait) = PendingUpload::create(targets);
        self.state
            .uploads
            .lock()
            .map_err(|_| "the host is poisoned")?
            .push(upload);
        Ok(wait)
    }

    pub async fn close(mut self) {
        self.state.closing.notify_waiters();
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        let _ = (&mut self.served).await;
    }
}

fn encode_query_value(value: &str) -> String {
    value
        .chars()
        .map(|letter| match letter {
            ':' => "%3A".to_owned(),
            '/' => "%2F".to_owned(),
            other => other.to_string(),
        })
        .collect()
}

fn create_router(state: Arc<HostState>) -> Router {
    Router::new()
        .route("/", get(handle_page))
        .route(PCM_ROUTE, get(handle_pcm))
        .route("/files/{token}/{name}", get(handle_file))
        .route("/models/{token}/{*name}", get(handle_directory))
        .route(JOB_SOCKET_PATH, any(handle_socket))
        .fallback(any(handle_asset))
        .with_state(state)
}

async fn handle_page() -> Response {
    let mut response = Response::new(Body::from(LOADER_HTML));
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static(HTML));
    response
}

async fn handle_pcm(State(state): State<Arc<HostState>>) -> Response {
    let mut response = Response::new(Body::from(state.pcm.clone()));
    let headers = response.headers_mut();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static(OCTET_STREAM));
    headers.insert("cache-control", HeaderValue::from_static(NO_STORE));
    response
}

async fn handle_file(
    State(state): State<Arc<HostState>>,
    axum::extract::Path((token, _name)): axum::extract::Path<(String, String)>,
) -> Response {
    let found = state
        .files
        .lock()
        .ok()
        .and_then(|files| files.get(&token).cloned());
    let Some(path) = found else {
        return missing();
    };
    match send_file(&path, OCTET_STREAM).await {
        Some(response) => response,
        None => missing(),
    }
}

async fn handle_directory(
    State(state): State<Arc<HostState>>,
    axum::extract::Path((token, name)): axum::extract::Path<(String, String)>,
) -> Response {
    let found = state
        .directories
        .lock()
        .ok()
        .and_then(|directories| directories.get(&token).cloned());
    let Some(root) = found else {
        return missing();
    };
    let Some(path) = resolve_asset(&root, &name) else {
        return missing();
    };
    let content_type = read_content_type(&path);
    match send_file(&path, content_type).await {
        Some(response) => response,
        None => missing(),
    }
}

async fn handle_asset(State(state): State<Arc<HostState>>, request: Request) -> Response {
    let pathname = request.uri().path().to_owned();
    if request.method() == axum::http::Method::PUT && pathname.starts_with(UPLOAD_ROUTE) {
        return receive_upload(&state, &pathname, request).await;
    }
    let Some(path) = resolve_asset(&state.bundle_path, &pathname) else {
        return missing();
    };
    let content_type = read_content_type(&path);
    match send_file(&path, content_type).await {
        Some(response) => response,
        None => missing(),
    }
}

fn missing() -> Response {
    (StatusCode::NOT_FOUND, "not found").into_response()
}

async fn handle_socket(State(state): State<Arc<HostState>>, upgrade: WebSocketUpgrade) -> Response {
    upgrade.on_upgrade(move |socket| serve_socket(socket, state))
}

async fn serve_socket(socket: WebSocket, state: Arc<HostState>) {
    let (outgoing, queued) = mpsc::unbounded_channel();
    state.attach(outgoing);
    read_socket(socket, &state, queued).await;
    state.disconnect();
}

async fn read_socket(
    mut socket: WebSocket,
    state: &Arc<HostState>,
    mut queued: mpsc::UnboundedReceiver<Message>,
) {
    loop {
        tokio::select! {
            () = state.closing.notified() => return,
            sending = queued.recv() => {
                let Some(message) = sending else {
                    return;
                };
                if socket.send(message).await.is_err() {
                    return;
                }
            }
            received = socket.recv() => {
                let Some(Ok(message)) = received else {
                    return;
                };
                if let Message::Text(text) = message {
                    state.accept(text.as_str());
                }
            }
        }
    }
}
