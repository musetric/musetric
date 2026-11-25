mod analysis;
mod audio;
mod item;
mod mixdown;
mod models;
mod preview;
mod processing;
mod project;
mod recording;
mod status;

use std::{path::PathBuf, sync::Arc};

use musetric_gpu::ExecutorHost;

use axum::Router;

use musetric_jobs::Queue;

use crate::{
    analysis::models::ModelPins, mixdown::Mixdowns, realtime, realtime::Rooms, storage::Storage,
};

#[derive(Clone)]
pub(crate) struct RouteState {
    pub(crate) rooms: Arc<Rooms>,
    pub(crate) storage: Arc<Storage>,
    pub(crate) queue: Arc<Queue>,
    pub(crate) executor: Arc<ExecutorHost>,
    pub(crate) models_path: PathBuf,
    pub(crate) pins: Arc<ModelPins>,
    pub(crate) mixdowns: Arc<Mixdowns>,
}

pub(crate) fn create_router(state: RouteState) -> Router {
    analysis::create_router()
        .merge(audio::create_router())
        .merge(mixdown::create_router())
        .merge(models::create_router())
        .merge(preview::create_router())
        .merge(processing::create_router())
        .merge(project::create_router())
        .merge(recording::create_router())
        .merge(status::create_router())
        .merge(realtime::create_router())
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use axum::{
        Router,
        body::Body,
        http::{Request, StatusCode},
        response::Response,
    };
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    use super::create_router;
    use crate::test_workspace::{Workspace, create_route_state};

    const RECORDING_PIECES_URL: &str = "/api/audio/project/1/recording/1/pieces";
    const RECORDINGS_URL: &str = "/api/project/1/recording";
    const CREATE_RECORDING: &str = "
      INSERT INTO Recording (id, projectId, name, active) VALUES (1, 1, 'Recording 1', 1);
    ";
    const CREATE_PROJECT: &str = "
      INSERT INTO Project (id, name, sampleRate, frameCount)
      VALUES (1, 'Fixture project', 44100, 441000);
    ";

    async fn read_body(response: Response<Body>) -> String {
        let payload = response
            .into_body()
            .collect()
            .await
            .expect("the body should be readable")
            .to_bytes();
        String::from_utf8(payload.to_vec()).expect("the body should be text")
    }

    async fn send(router: Router, method: &str, url: &str, body: &str) -> Response<Body> {
        let request = Request::builder()
            .method(method)
            .uri(url)
            .header("content-type", "application/json")
            .body(Body::from(body.to_owned()))
            .expect("the request should be valid");
        router
            .oneshot(request)
            .await
            .expect("the router should answer")
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
    async fn refuses_to_switch_the_recording_while_a_take_is_saved() {
        let workspace = Workspace::new();
        workspace.seed(CREATE_PROJECT);
        workspace.seed(CREATE_RECORDING);
        let state = create_route_state(&workspace, workspace.create_storage()).await;
        let saving = state.rooms.begin_edit(1).expect("the room should be free");
        let router = create_router(state.clone());

        let created = send(
            router.clone(),
            "POST",
            &format!("{RECORDINGS_URL}/create"),
            "",
        )
        .await;
        let renamed = send(
            router.clone(),
            "PATCH",
            &format!("{RECORDINGS_URL}/1/edit"),
            "{\"name\":\"Warm up\"}",
        )
        .await;

        assert_eq!(created.status(), StatusCode::CONFLICT);
        assert_eq!(renamed.status(), StatusCode::OK);
        state.rooms.end_session(1, saving);
        let freed = send(router, "POST", &format!("{RECORDINGS_URL}/create"), "").await;
        assert_eq!(freed.status(), StatusCode::OK);
    }

    fn take_form(start_frame: u32, samples: &[f32]) -> (String, Vec<u8>) {
        let boundary = "loop-try";
        let mut body = Vec::new();
        let fields = [
            ("startFrame", start_frame.to_string()),
            ("tempo", "1".to_owned()),
            ("transpose", "0".to_owned()),
            ("octave", "0".to_owned()),
            ("sampleRate", "44100".to_owned()),
            ("frameCount", "441000".to_owned()),
        ];
        for (name, value) in fields {
            body.extend_from_slice(
                format!(
                    "--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n"
                )
                .as_bytes(),
            );
        }
        body.extend_from_slice(
            format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"samples\"; filename=\"take.f32\"\r\nContent-Type: application/octet-stream\r\n\r\n"
            )
            .as_bytes(),
        );
        for sample in samples {
            body.extend_from_slice(&sample.to_le_bytes());
        }
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
        (format!("multipart/form-data; boundary={boundary}"), body)
    }

    async fn send_take(router: Router, start_frame: u32, samples: &[f32]) -> Response<Body> {
        let (content_type, body) = take_form(start_frame, samples);
        let request = Request::builder()
            .method("POST")
            .uri(format!("{RECORDINGS_URL}/1/take"))
            .header("content-type", content_type)
            .body(Body::from(body))
            .expect("the request should be valid");
        router
            .oneshot(request)
            .await
            .expect("the router should answer")
    }

    #[tokio::test]
    async fn inserts_a_loop_try_as_the_fresh_take() {
        let workspace = Workspace::new();
        workspace.seed(CREATE_PROJECT);
        workspace.seed(CREATE_RECORDING);
        let state = create_route_state(&workspace, workspace.create_storage()).await;
        let saving = state.rooms.begin_edit(1).expect("the room should be free");
        let router = create_router(state.clone());

        let refused = send_take(router.clone(), 4410, &[0.5; 8]).await;
        assert_eq!(refused.status(), StatusCode::CONFLICT);
        state.rooms.end_session(1, saving);

        let inserted = send_take(router.clone(), 4410, &[0.5; 8]).await;
        assert_eq!(inserted.status(), StatusCode::OK);
        let response = request(router, RECORDING_PIECES_URL).await;
        let listed: serde_json::Value =
            serde_json::from_str(&read_body(response).await).expect("the pieces should be json");
        let pieces = listed["pieces"]
            .as_array()
            .expect("the pieces should be a list");
        assert_eq!(pieces.len(), 1);
        assert_eq!(pieces[0]["songStartFrame"], 4410);
        assert_eq!(pieces[0]["frameCount"], 8);
    }
}
