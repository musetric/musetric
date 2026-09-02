use std::{path::PathBuf, sync::Arc, time::SystemTime};

use axum::{
    Router,
    body::Body,
    extract::{Path, State},
    http::{HeaderMap, HeaderValue, Request, StatusCode, header::CONTENT_TYPE},
    response::Response,
    routing::{MethodRouter, get},
};
use musetric_db::{Analysis, blob_path};
use tokio::{
    fs::{File, metadata},
    task::spawn_blocking,
};
use tokio_util::io::ReaderStream;

use crate::{
    cached_file::{CachedFile, CachedHeaders},
    proxy::{ProxyState, forward},
    storage::Storage,
};

const CONTENT_TYPE_JSON: &str = "application/json";
const CONTENT_TYPE_ERROR: &str = "application/json; charset=utf-8";

#[derive(Clone)]
pub(crate) struct AnalysisState {
    proxy: ProxyState,
    storage: Arc<Storage>,
}

enum Failure {
    NotFound(String),
    Failed(String),
}

struct AnalysisBlob {
    path: PathBuf,
    project_name: String,
}

struct BlobStat {
    size: u64,
    modified: SystemTime,
}

pub(crate) fn create_router(proxy: ProxyState, storage: Arc<Storage>) -> Router {
    Router::new()
        .route(
            "/api/chords/project/{projectId}",
            create_route(Analysis::Chords),
        )
        .route("/api/key/project/{projectId}", create_route(Analysis::Key))
        .route(
            "/api/rhythm/project/{projectId}",
            create_route(Analysis::Rhythm),
        )
        .route(
            "/api/subtitle/project/{projectId}",
            create_route(Analysis::Subtitle),
        )
        .with_state(AnalysisState { proxy, storage })
}

fn create_route(analysis: Analysis) -> MethodRouter<AnalysisState> {
    get(
        move |State(state): State<AnalysisState>,
              Path(project_id): Path<String>,
              request: Request<Body>| async move {
            handle(analysis, state, &project_id, request).await
        },
    )
}

async fn handle(
    analysis: Analysis,
    state: AnalysisState,
    raw_project_id: &str,
    request: Request<Body>,
) -> Response<Body> {
    let Ok(project_id) = raw_project_id.parse::<i64>() else {
        return forward(&state.proxy, request).await;
    };
    match send_analysis(analysis, &state.storage, project_id, request.headers()).await {
        Ok(response) => response,
        Err(failure) => create_failure_response(failure),
    }
}

async fn send_analysis(
    analysis: Analysis,
    storage: &Arc<Storage>,
    project_id: i64,
    request: &HeaderMap,
) -> Result<Response<Body>, Failure> {
    let blob = read_analysis_blob(analysis, storage, project_id).await?;
    let stat = read_blob_stat(&blob, analysis, project_id).await?;
    let file = CachedFile {
        filename: format!(
            "{}_{}.json",
            blob.project_name,
            analysis.table().to_ascii_lowercase()
        ),
        content_type: CONTENT_TYPE_JSON,
        size: stat.size,
        modified: stat.modified,
    };
    let headers =
        CachedHeaders::create(&file).map_err(|error| Failure::Failed(error.to_string()))?;
    if headers.is_not_modified(request) {
        return Ok(headers.respond_not_modified());
    }
    let content = File::open(&blob.path)
        .await
        .map_err(|error| Failure::Failed(error.to_string()))?;
    let body = Body::from_stream(ReaderStream::new(content));
    Ok(headers.respond(file.size, body))
}

async fn read_analysis_blob(
    analysis: Analysis,
    storage: &Arc<Storage>,
    project_id: i64,
) -> Result<AnalysisBlob, Failure> {
    let owned = Arc::clone(storage);
    let read = spawn_blocking(move || {
        let blob_id = owned.database.analysis_blob(analysis, project_id)?;
        let project_name = owned.database.project_name(project_id)?;
        Ok::<_, musetric_db::BoxedError>((blob_id, project_name))
    })
    .await
    .map_err(|error| Failure::Failed(error.to_string()))?;
    let (found_blob, found_project) = read.map_err(|error| Failure::Failed(error.to_string()))?;
    let title = analysis.table();
    let blob_id = found_blob
        .ok_or_else(|| Failure::NotFound(format!("{title} for project {project_id} not found")))?;
    let project_name = found_project
        .ok_or_else(|| Failure::NotFound(format!("Project with id {project_id} not found")))?;
    Ok(AnalysisBlob {
        path: blob_path(&storage.blobs_path, &blob_id),
        project_name,
    })
}

async fn read_blob_stat(
    blob: &AnalysisBlob,
    analysis: Analysis,
    project_id: i64,
) -> Result<BlobStat, Failure> {
    let title = analysis.table();
    let missing = || Failure::NotFound(format!("{title} blob for project {project_id} not found"));
    let metadata = metadata(&blob.path).await.map_err(|_| missing())?;
    let modified = metadata.modified().map_err(|_| missing())?;
    Ok(BlobStat {
        size: metadata.len(),
        modified,
    })
}

fn create_failure_response(failure: Failure) -> Response<Body> {
    let (status, message) = match failure {
        Failure::NotFound(message) => (StatusCode::NOT_FOUND, message),
        Failure::Failed(message) => (StatusCode::INTERNAL_SERVER_ERROR, message),
    };
    let payload = serde_json::json!({ "message": message }).to_string();
    let mut response = Response::new(Body::from(payload));
    *response.status_mut() = status;
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static(CONTENT_TYPE_ERROR));
    response
}

#[cfg(test)]
mod tests {
    use std::{
        fs::{create_dir_all, remove_dir_all, write},
        net::SocketAddr,
        path::PathBuf,
        process::id,
        sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        },
        time::{SystemTime, UNIX_EPOCH},
    };

    use axum::{
        Router,
        body::{Body, to_bytes},
        http::{Request, StatusCode, header::IF_NONE_MATCH},
        response::Response,
        routing::any,
    };
    use http_body_util::BodyExt;
    use musetric_db::{OpenOptions, Reader, blob_path, init_database, open_database};
    use tokio::{net::TcpListener, sync::oneshot};
    use tower::ServiceExt;

    use super::create_router;
    use crate::{proxy::ProxyState, storage::Storage};

    const BLOB_ID: &str = "1f2e3d4c-0000-4000-8000-000000000001";
    const CHORDS: &str = "{\"segments\":[]}";
    const CREATE_PROJECT: &str = "
      INSERT INTO Project (id, name, sampleRate, frameCount)
      VALUES (1, 'Fixture project', 44100, 441000);
    ";
    const CREATE_CHORDS: &str = "
      INSERT INTO Chords (projectId, blobId)
      VALUES (1, '1f2e3d4c-0000-4000-8000-000000000001');
    ";

    static WORKSPACE_COUNT: AtomicUsize = AtomicUsize::new(0);

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
                std::env::temp_dir().join(format!("musetric-analysis-{}-{stamp}-{ordinal}", id()));
            create_dir_all(&directory).expect("the workspace should be created");
            let workspace = Self { directory };
            init_database(&workspace.database_path()).expect("the database should be created");
            workspace
        }

        fn database_path(&self) -> PathBuf {
            self.directory.join("db").join("app.db")
        }

        fn blobs_path(&self) -> PathBuf {
            self.directory.join("blobs")
        }

        fn seed(&self, statements: &str) {
            let options = OpenOptions {
                foreign_keys: false,
            };
            let connection =
                open_database(&self.database_path(), &options).expect("the database should open");
            connection
                .execute_batch(statements)
                .expect("the fixture should be written");
        }

        fn add_blob(&self, content: &str) {
            let path = blob_path(&self.blobs_path(), BLOB_ID);
            let directory = path.parent().expect("a blob path should have a directory");
            create_dir_all(directory).expect("the blob directory should be created");
            write(&path, content).expect("the blob should be written");
        }

        fn create_router(&self, upstream: SocketAddr) -> Router {
            let storage = Arc::new(Storage {
                database: Reader::open(&self.database_path()).expect("the reader should open"),
                blobs_path: self.blobs_path(),
            });
            let address = format!("http://{upstream}")
                .parse()
                .expect("the upstream should be a valid uri");
            create_router(ProxyState::create(address), storage)
        }
    }

    impl Drop for Workspace {
        fn drop(&mut self) {
            let _ = remove_dir_all(&self.directory);
        }
    }

    async fn start_upstream() -> (SocketAddr, oneshot::Sender<()>) {
        let app = Router::new().fallback(any(|request: Request<Body>| async move {
            format!("upstream answered {}", request.uri())
        }));
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("the upstream should bind");
        let address = listener
            .local_addr()
            .expect("the upstream should have an address");
        let (shutdown_sender, shutdown_receiver) = oneshot::channel();
        tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = shutdown_receiver.await;
                })
                .await
                .expect("the upstream should stop cleanly");
        });
        (address, shutdown_sender)
    }

    fn read_header(response: &Response<Body>, name: &str) -> Option<String> {
        response
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned)
    }

    async fn read_body(response: Response<Body>) -> String {
        let payload = response
            .into_body()
            .collect()
            .await
            .expect("the body should be readable")
            .to_bytes();
        String::from_utf8(payload.to_vec()).expect("the body should be text")
    }

    async fn request(router: Router, url: &str) -> Response<Body> {
        let request = Request::builder()
            .uri(url)
            .body(Body::empty())
            .expect("the request should be valid");
        router
            .oneshot(request)
            .await
            .expect("the router should answer")
    }

    #[tokio::test]
    async fn sends_the_blob_named_after_the_project() {
        let workspace = Workspace::new();
        workspace.seed(CREATE_PROJECT);
        workspace.seed(CREATE_CHORDS);
        workspace.add_blob(CHORDS);
        let (upstream, shutdown) = start_upstream().await;

        let response = request(workspace.create_router(upstream), "/api/chords/project/1").await;

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            read_header(&response, "content-disposition"),
            Some("attachment; filename*=UTF-8''Fixture%20project_chords.json".to_owned())
        );
        assert_eq!(
            read_header(&response, "content-length"),
            Some("15".to_owned())
        );
        let body = to_bytes(response.into_body(), CHORDS.len())
            .await
            .expect("the body should be readable");
        assert_eq!(&body[..], CHORDS.as_bytes());
        let _ = shutdown.send(());
    }

    #[tokio::test]
    async fn answers_not_modified_when_the_sent_tag_matches() {
        let workspace = Workspace::new();
        workspace.seed(CREATE_PROJECT);
        workspace.seed(CREATE_CHORDS);
        workspace.add_blob(CHORDS);
        let (upstream, shutdown) = start_upstream().await;
        let router = workspace.create_router(upstream);
        let first = request(router.clone(), "/api/chords/project/1").await;
        let etag = read_header(&first, "etag").expect("the answer should carry an etag");

        let repeated = Request::builder()
            .uri("/api/chords/project/1")
            .header(IF_NONE_MATCH, etag)
            .body(Body::empty())
            .expect("the request should be valid");
        let response = router
            .oneshot(repeated)
            .await
            .expect("the router should answer");

        assert_eq!(response.status(), StatusCode::NOT_MODIFIED);
        assert_eq!(read_header(&response, "etag"), read_header(&first, "etag"));
        assert_eq!(read_body(response).await, "");
        let _ = shutdown.send(());
    }

    #[tokio::test]
    async fn tells_a_missing_row_a_missing_project_and_a_missing_blob_apart() {
        let workspace = Workspace::new();
        let (upstream, shutdown) = start_upstream().await;

        let without_row = request(workspace.create_router(upstream), "/api/chords/project/1").await;
        workspace.seed(CREATE_CHORDS);
        let without_project =
            request(workspace.create_router(upstream), "/api/chords/project/1").await;
        workspace.seed(CREATE_PROJECT);
        let without_blob =
            request(workspace.create_router(upstream), "/api/chords/project/1").await;

        assert_eq!(without_row.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            read_header(&without_row, "content-type"),
            Some("application/json; charset=utf-8".to_owned())
        );
        assert_eq!(
            read_body(without_row).await,
            "{\"message\":\"Chords for project 1 not found\"}"
        );
        assert_eq!(
            read_body(without_project).await,
            "{\"message\":\"Project with id 1 not found\"}"
        );
        assert_eq!(
            read_body(without_blob).await,
            "{\"message\":\"Chords blob for project 1 not found\"}"
        );
        let _ = shutdown.send(());
    }

    #[tokio::test]
    async fn leaves_a_project_id_it_cannot_read_to_the_upstream() {
        let workspace = Workspace::new();
        let (upstream, shutdown) = start_upstream().await;

        let response = request(workspace.create_router(upstream), "/api/chords/project/abc").await;

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            read_body(response).await,
            "upstream answered /api/chords/project/abc"
        );
        let _ = shutdown.send(());
    }
}
