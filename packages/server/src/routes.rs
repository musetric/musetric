mod analysis;
mod audio;
mod preview;
mod project;

use std::sync::Arc;

use axum::Router;

use crate::{proxy::ProxyState, realtime, realtime::Rooms, storage::Storage};

#[derive(Clone)]
pub(crate) struct RouteState {
    pub(crate) proxy: ProxyState,
    pub(crate) rooms: Arc<Rooms>,
    pub(crate) storage: Arc<Storage>,
}

pub(crate) fn create_router(proxy: ProxyState, rooms: Arc<Rooms>, storage: Arc<Storage>) -> Router {
    analysis::create_router()
        .merge(audio::create_router())
        .merge(preview::create_router())
        .merge(project::create_router())
        .merge(realtime::create_router())
        .with_state(RouteState {
            proxy,
            rooms,
            storage,
        })
}

#[cfg(test)]
mod tests {
    use std::{net::SocketAddr, sync::Arc};

    use axum::{
        Router,
        body::{Body, to_bytes},
        http::{Request, StatusCode, header::IF_NONE_MATCH},
        response::Response,
        routing::any,
    };
    use http_body_util::BodyExt;
    use tokio::{net::TcpListener, sync::oneshot};
    use tower::ServiceExt;

    use super::create_router;
    use crate::{proxy::ProxyState, realtime::Rooms, test_workspace::Workspace};

    const BLOB_ID: &str = "1f2e3d4c-0000-4000-8000-000000000001";
    const OTHER_BLOB_ID: &str = "5a6b7c8d-0000-4000-8000-000000000002";
    const CHORDS: &str = "{\"segments\":[]}";
    const AUDIO: &str = "fixture audio";
    const PEAKS: &str = "fixture peaks";
    const PREVIEW: &str = "fixture preview";
    const FLAC: &str = "audio/flac";
    const FMP4: &str = "audio/mp4";
    const NO_STORE: &str = "no-store";
    const WAV_HEADER_BYTE_LENGTH: usize = 44;
    const PEAKS_BYTE_LENGTH: usize = 3840 * 2 * 4;
    const SOURCE_URL: &str = "/api/audio/project/1/master/source/content";
    const LEAD_URL: &str = "/api/audio/project/1/master/lead/content";
    const DELIVERY_URL: &str = "/api/audio/project/1/delivery/lead/content";
    const WAVE_URL: &str = "/api/audio/project/1/delivery/lead/wave";
    const RECORDING_URL: &str = "/api/audio/project/1/recording/content";
    const RECORDING_WAVE_URL: &str = "/api/audio/project/1/recording/wave";
    const CREATE_PROJECT: &str = "
      INSERT INTO Project (id, name, sampleRate, frameCount)
      VALUES (1, 'Fixture project', 44100, 441000);
    ";
    const CREATE_CHORDS: &str = "
      INSERT INTO Chords (projectId, blobId)
      VALUES (1, '1f2e3d4c-0000-4000-8000-000000000001');
    ";
    const CREATE_MASTERS: &str = "
      INSERT INTO AudioMaster (projectId, type, blobId)
      VALUES (1, 'source', '1f2e3d4c-0000-4000-8000-000000000001'),
             (1, 'lead', '5a6b7c8d-0000-4000-8000-000000000002');
    ";
    const CREATE_DELIVERY: &str = "
      INSERT INTO AudioDelivery (projectId, stemType, blobId, waveBlobId)
      VALUES (1, 'lead', '1f2e3d4c-0000-4000-8000-000000000001',
                         '5a6b7c8d-0000-4000-8000-000000000002');
    ";
    const CREATE_PREVIEW: &str = "
      INSERT INTO Preview (projectId, blobId, filename, contentType)
      VALUES (1, '1f2e3d4c-0000-4000-8000-000000000001', 'preview.png', 'image/png');
    ";

    fn create_test_router(workspace: &Workspace, upstream: SocketAddr) -> Router {
        let address = format!("http://{upstream}")
            .parse()
            .expect("the upstream should be a valid uri");
        create_router(
            ProxyState::create(address),
            Arc::new(Rooms::create()),
            workspace.create_storage(),
        )
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
        workspace.add_blob(BLOB_ID, CHORDS);
        let (upstream, shutdown) = start_upstream().await;

        let response = request(
            create_test_router(&workspace, upstream),
            "/api/chords/project/1",
        )
        .await;

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
        workspace.add_blob(BLOB_ID, CHORDS);
        let (upstream, shutdown) = start_upstream().await;
        let router = create_test_router(&workspace, upstream);
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

        let without_row = request(
            create_test_router(&workspace, upstream),
            "/api/chords/project/1",
        )
        .await;
        workspace.seed(CREATE_CHORDS);
        let without_project = request(
            create_test_router(&workspace, upstream),
            "/api/chords/project/1",
        )
        .await;
        workspace.seed(CREATE_PROJECT);
        let without_blob = request(
            create_test_router(&workspace, upstream),
            "/api/chords/project/1",
        )
        .await;

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

        let response = request(
            create_test_router(&workspace, upstream),
            "/api/chords/project/abc",
        )
        .await;

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            read_body(response).await,
            "upstream answered /api/chords/project/abc"
        );
        let _ = shutdown.send(());
    }

    #[tokio::test]
    async fn names_a_master_stem_after_the_project_and_the_stem() {
        let workspace = Workspace::new();
        workspace.seed(CREATE_PROJECT);
        workspace.seed(CREATE_MASTERS);
        workspace.add_blob(BLOB_ID, AUDIO);
        workspace.add_blob(OTHER_BLOB_ID, AUDIO);
        let (upstream, shutdown) = start_upstream().await;
        let router = create_test_router(&workspace, upstream);

        let source = request(router.clone(), SOURCE_URL).await;
        let lead = request(router, LEAD_URL).await;

        assert_eq!(
            read_header(&source, "content-disposition"),
            Some("attachment; filename*=UTF-8''Fixture%20project.flac".to_owned())
        );
        assert_eq!(read_header(&source, "content-type"), Some(FLAC.to_owned()));
        assert_eq!(
            read_header(&lead, "content-disposition"),
            Some("attachment; filename*=UTF-8''Fixture%20project_lead.flac".to_owned())
        );
        let _ = shutdown.send(());
    }

    #[tokio::test]
    async fn reads_the_delivery_and_its_peaks_from_one_row() {
        let workspace = Workspace::new();
        workspace.seed(CREATE_PROJECT);
        workspace.seed(CREATE_DELIVERY);
        workspace.add_blob(BLOB_ID, AUDIO);
        workspace.add_blob(OTHER_BLOB_ID, PEAKS);
        let (upstream, shutdown) = start_upstream().await;
        let router = create_test_router(&workspace, upstream);

        let content = request(router.clone(), DELIVERY_URL).await;
        let wave = request(router, WAVE_URL).await;

        assert_eq!(
            read_header(&content, "content-disposition"),
            Some("attachment; filename*=UTF-8''Fixture%20project_lead.mp4".to_owned())
        );
        assert_eq!(read_header(&content, "content-type"), Some(FMP4.to_owned()));
        assert_eq!(
            read_header(&wave, "content-disposition"),
            Some("attachment; filename*=UTF-8''waveform.bin".to_owned())
        );
        assert_eq!(read_body(wave).await, PEAKS);
        let _ = shutdown.send(());
    }

    #[tokio::test]
    async fn hands_out_an_empty_take_when_nothing_is_recorded() {
        let workspace = Workspace::new();
        workspace.seed(CREATE_PROJECT);
        let (upstream, shutdown) = start_upstream().await;
        let router = create_test_router(&workspace, upstream);

        let content = request(router.clone(), RECORDING_URL).await;
        let wave = request(router, RECORDING_WAVE_URL).await;

        assert_eq!(content.status(), StatusCode::OK);
        assert_eq!(
            read_header(&content, "cache-control"),
            Some(NO_STORE.to_owned())
        );
        assert_eq!(
            read_header(&content, "content-type"),
            Some("audio/wav".to_owned())
        );
        assert_eq!(read_header(&content, "content-length"), None);
        assert_eq!(read_header(&wave, "content-length"), None);
        let header = to_bytes(content.into_body(), WAV_HEADER_BYTE_LENGTH)
            .await
            .expect("the body should be readable");
        assert_eq!(header.len(), WAV_HEADER_BYTE_LENGTH);
        assert_eq!(&header[..4], b"RIFF");
        assert_eq!(
            read_header(&wave, "cache-control"),
            Some(NO_STORE.to_owned())
        );
        let peaks = to_bytes(wave.into_body(), PEAKS_BYTE_LENGTH)
            .await
            .expect("the body should be readable");
        assert_eq!(peaks.len(), PEAKS_BYTE_LENGTH);
        assert!(peaks.iter().all(|byte| *byte == 0));
        let _ = shutdown.send(());
    }

    #[tokio::test]
    async fn leaves_a_stem_type_it_does_not_know_to_the_upstream() {
        let workspace = Workspace::new();
        let (upstream, shutdown) = start_upstream().await;

        let response = request(
            create_test_router(&workspace, upstream),
            "/api/audio/project/1/delivery/vocals/content",
        )
        .await;

        assert_eq!(
            read_body(response).await,
            "upstream answered /api/audio/project/1/delivery/vocals/content"
        );
        let _ = shutdown.send(());
    }

    #[tokio::test]
    async fn sends_a_preview_with_the_content_type_it_was_stored_with() {
        let workspace = Workspace::new();
        workspace.seed(CREATE_PROJECT);
        workspace.seed(CREATE_PREVIEW);
        workspace.add_blob(BLOB_ID, PREVIEW);
        let (upstream, shutdown) = start_upstream().await;

        let response = request(create_test_router(&workspace, upstream), "/api/preview/1").await;

        assert_eq!(
            read_header(&response, "content-type"),
            Some("image/png".to_owned())
        );
        assert_eq!(
            read_header(&response, "content-disposition"),
            Some("attachment; filename*=UTF-8''preview.png".to_owned())
        );
        assert_eq!(read_body(response).await, PREVIEW);
        let _ = shutdown.send(());
    }
}
