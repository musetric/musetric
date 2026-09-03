mod channel;
mod events;
mod packet;
mod rooms;
mod session;

use std::{num::ParseIntError, sync::Arc};

use axum::{
    Router,
    extract::{Path, State, WebSocketUpgrade, ws::Message, ws::WebSocket},
    response::{IntoResponse, Response},
    routing::get,
};
use musetric_db::BoxedError;
use serde_json::Value;

use crate::{
    realtime::channel::{CLOSE_POLICY, CLOSE_UNSUPPORTED, Channel},
    routes::RouteState,
    storage::{Storage, read},
};

pub(crate) use rooms::Rooms;

pub(crate) fn create_router() -> Router<RouteState> {
    Router::new().route("/api/project/{projectId}/realtime", get(upgrade))
}

async fn upgrade(
    Path(raw_project_id): Path<String>,
    State(state): State<RouteState>,
    upgrade: WebSocketUpgrade,
) -> Response {
    let parsed_project_id = raw_project_id.parse::<i64>();
    upgrade
        .on_upgrade(move |connected_socket| serve(connected_socket, state, parsed_project_id))
        .into_response()
}

async fn serve(
    socket: WebSocket,
    state: RouteState,
    parsed_project_id: Result<i64, ParseIntError>,
) {
    let Ok(project_id) = parsed_project_id else {
        let mut refused = socket;
        let _ = refused
            .send(events::close(
                CLOSE_POLICY,
                "Invalid project realtime request",
            ))
            .await;
        return;
    };
    let (member, outgoing) = state.rooms.join(project_id);
    let mut channel = Channel::create(socket, outgoing);
    let mut connection = Connection::new(project_id, member, Arc::clone(&state.storage));
    if open_project(&mut channel, &state.storage, project_id).await {
        run_connection(&mut channel, &state.rooms, &mut connection).await;
    }
    state.rooms.leave(project_id, member);
    let _ = finish_session(&state.rooms, &mut connection).await;
}

async fn open_project(channel: &mut Channel, storage: &Arc<Storage>, project_id: i64) -> bool {
    let found = read(storage, move |database| database.project_name(project_id)).await;
    if matches!(found, Ok(Some(_))) {
        return true;
    }
    if found.is_ok() {
        channel
            .close(
                CLOSE_POLICY,
                &format!("Project with id {project_id} not found"),
            )
            .await;
    } else {
        channel
            .fail("Failed to open project realtime session")
            .await;
    }
    false
}

async fn run_connection(channel: &mut Channel, rooms: &Rooms, connection: &mut Connection) {
    while let Some(incoming) = channel.receive().await {
        if !receive_message(channel, rooms, connection, incoming).await {
            break;
        }
    }
}

struct Connection {
    project_id: i64,
    member: rooms::MemberId,
    storage: Arc<Storage>,
    session: Option<session::Session>,
    ignoring_recording_stream: bool,
}

impl Connection {
    fn new(project_id: i64, member: rooms::MemberId, storage: Arc<Storage>) -> Self {
        Self {
            project_id,
            member,
            storage,
            session: None,
            ignoring_recording_stream: false,
        }
    }
}

async fn receive_message(
    channel: &mut Channel,
    rooms: &Rooms,
    connection: &mut Connection,
    incoming: Message,
) -> bool {
    match incoming {
        Message::Text(message) => handle_text(channel, rooms, connection, &message).await,
        Message::Binary(packet) => handle_packet(channel, rooms, connection, &packet).await,
        Message::Ping(_) | Message::Pong(_) => true,
        Message::Close(_) => false,
    }
}

async fn handle_text(
    channel: &mut Channel,
    rooms: &Rooms,
    connection: &mut Connection,
    message: &str,
) -> bool {
    let parsed_event: Value = if let Ok(event) = serde_json::from_str(message) {
        event
    } else {
        channel.fail("Invalid project realtime message").await;
        return false;
    };
    let Some(event) = parsed_event.as_object() else {
        return true;
    };
    let Some(kind) = event.get("type").and_then(Value::as_str) else {
        return true;
    };
    match kind {
        "recording.start" => {
            let Some(start) = read_recording_start(event) else {
                channel
                    .close(CLOSE_POLICY, "Invalid recording start message")
                    .await;
                return false;
            };
            start_recording(channel, rooms, connection, start).await
        }
        "recording.finish" => finish_recording(channel, rooms, connection).await,
        "player.play" => {
            rooms.claim_master(connection.project_id, connection.member, false);
            true
        }
        "player.record" => {
            rooms.claim_master(connection.project_id, connection.member, true);
            true
        }
        "player.stop" => {
            rooms.stop_player(connection.project_id);
            true
        }
        "player.frameIndex" => {
            rooms.set_frame_index(
                connection.project_id,
                connection.member,
                &read_frame_index(event),
            );
            true
        }
        "player.sync.request" => {
            rooms.request_sync(connection.project_id, connection.member);
            true
        }
        _ => true,
    }
}

async fn start_recording(
    channel: &mut Channel,
    rooms: &Rooms,
    connection: &mut Connection,
    start: RecordingStart,
) -> bool {
    if !rooms.claim_master(connection.project_id, connection.member, true) {
        connection.ignoring_recording_stream = true;
        rooms.send_to(
            connection.project_id,
            connection.member,
            &events::recording_finished(),
        );
        return true;
    }
    if finish_session(rooms, connection).await.is_err() {
        channel.fail("Failed to start recording session").await;
        return false;
    }
    if !rooms.begin_session(connection.project_id, connection.member) {
        channel.fail("Failed to start recording session").await;
        return false;
    }
    let created = session::Session::create(
        &connection.storage,
        connection.project_id,
        start.sample_rate,
        start.frame_count,
    )
    .await;
    let Ok(session) = created else {
        rooms.end_session(connection.project_id, connection.member);
        channel.fail("Failed to start recording session").await;
        return false;
    };
    connection.session = Some(session);
    rooms.broadcast_event(connection.project_id, &events::recording_started(), None);
    true
}

async fn finish_recording(
    channel: &mut Channel,
    rooms: &Rooms,
    connection: &mut Connection,
) -> bool {
    if connection.ignoring_recording_stream {
        connection.ignoring_recording_stream = false;
        rooms.send_to(
            connection.project_id,
            connection.member,
            &events::recording_finished(),
        );
        return true;
    }
    if finish_session(rooms, connection).await.is_err() {
        channel.fail("Failed to finish recording session").await;
        return false;
    }
    true
}

async fn handle_packet(
    channel: &mut Channel,
    rooms: &Rooms,
    connection: &mut Connection,
    raw_packet: &[u8],
) -> bool {
    if connection.ignoring_recording_stream {
        return true;
    }
    let Some(session) = connection.session.as_mut() else {
        channel
            .close(
                CLOSE_UNSUPPORTED,
                "Recording packet must follow recording start",
            )
            .await;
        return false;
    };
    let Ok(outcome) = write_packet(session, raw_packet).await else {
        channel.fail("Failed to write recording packet").await;
        return false;
    };
    let Some(written) = outcome else {
        return true;
    };
    rooms.broadcast_packet(connection.project_id, written.chunk, connection.member);
    if let Some(patch) = written.patch {
        rooms.broadcast_event(
            connection.project_id,
            &events::peaks_changed(patch.start_peak_index, &patch.peaks),
            None,
        );
    }
    true
}

struct WrittenPacket {
    chunk: Vec<u8>,
    patch: Option<session::PeakPatch>,
}

async fn write_packet(
    session: &mut session::Session,
    raw_packet: &[u8],
) -> Result<Option<WrittenPacket>, BoxedError> {
    let stream = packet::parse(raw_packet)?;
    let written = session
        .write_chunk(stream.frame_index, &stream.samples)
        .await?;
    if written == 0 {
        return Ok(None);
    }
    let patch = session.patch_peaks(stream.frame_index, written).await?;
    let chunk = packet::create_chunk(stream.frame_index, &stream.samples[..written])?;
    Ok(Some(WrittenPacket { chunk, patch }))
}

async fn finish_session(rooms: &Rooms, connection: &mut Connection) -> Result<(), BoxedError> {
    let Some(session) = connection.session.take() else {
        return Ok(());
    };
    let finished = session.finish(&connection.storage).await;
    rooms.end_session(connection.project_id, connection.member);
    finished?;
    rooms.broadcast_event(connection.project_id, &events::recording_finished(), None);
    Ok(())
}

struct RecordingStart {
    sample_rate: i64,
    frame_count: i64,
}

fn read_recording_start(event: &serde_json::Map<String, Value>) -> Option<RecordingStart> {
    let sample_rate = read_integer(event.get("sampleRate")?)?;
    let frame_count = read_integer(event.get("frameCount")?)?;
    let latency_frame_count = read_integer(event.get("latencyFrameCount")?)?;
    if sample_rate == 0 || frame_count < 0 || latency_frame_count < 0 {
        return None;
    }
    Some(RecordingStart {
        sample_rate,
        frame_count,
    })
}

fn read_frame_index(event: &serde_json::Map<String, Value>) -> rooms::FrameIndexUpdate {
    rooms::FrameIndexUpdate {
        frame_index: event
            .get("frameIndex")
            .and_then(Value::as_f64)
            .unwrap_or(0.0),
        frozen: event
            .get("frozen")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        revision: event.get("revision").and_then(Value::as_f64).unwrap_or(0.0),
        from_user: event.get("source").and_then(Value::as_str) == Some("user"),
    }
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "the WebSocket protocol accepts integer JavaScript numbers"
)]
fn read_integer(json_value: &Value) -> Option<i64> {
    const MIN_INTEGER: f64 = -9_223_372_036_854_775_808.0;
    const MAX_INTEGER_EXCLUSIVE: f64 = 9_223_372_036_854_775_808.0;
    let number = json_value.as_f64()?;
    if !number.is_finite()
        || number.fract() != 0.0
        || !(MIN_INTEGER..MAX_INTEGER_EXCLUSIVE).contains(&number)
    {
        return None;
    }
    Some(number as i64)
}

#[cfg(test)]
mod tests {
    use std::{sync::Arc, time::Duration};

    use axum::Router;
    use futures_util::{SinkExt, StreamExt};
    use serde_json::{Value, json};
    use tokio::{net::TcpListener, task::JoinHandle, time::timeout};
    use tokio_tungstenite::{
        connect_async,
        tungstenite::{Message as ClientMessage, Utf8Bytes},
    };

    use super::packet;
    use crate::{
        routes,
        storage::Storage,
        test_workspace::{Workspace, create_route_state},
    };

    const PROJECT: &str = "
      INSERT INTO Project (id, name, sampleRate, frameCount)
      VALUES (1, 'Fixture project', 48000, 480000);
    ";
    const FRAME_COUNT: usize = 4;
    const SILENCE: Duration = Duration::from_millis(300);

    type ClientSocket = tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >;

    struct TestServer {
        task: JoinHandle<()>,
    }

    impl Drop for TestServer {
        fn drop(&mut self) {
            self.task.abort();
        }
    }

    async fn start_server(storage: Arc<Storage>) -> (String, TestServer) {
        let application: Router = routes::create_router(create_route_state(storage));
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("the test server should bind");
        let address = listener
            .local_addr()
            .expect("the test server should have an address");
        let server = tokio::spawn(async move {
            axum::serve(listener, application)
                .await
                .expect("the test server should stop cleanly");
        });
        (format!("ws://{address}"), TestServer { task: server })
    }

    fn realtime_url(base: &str, project_id: i64) -> String {
        format!("{base}/api/project/{project_id}/realtime")
    }

    async fn connect(base: &str) -> ClientSocket {
        let (socket, _) = connect_async(realtime_url(base, 1))
            .await
            .expect("the client should connect");
        socket
    }

    async fn receive_json(socket: &mut ClientSocket) -> Value {
        let received_message = socket
            .next()
            .await
            .expect("the server should send an event")
            .expect("the event should be valid");
        let ClientMessage::Text(event_text) = received_message else {
            panic!("the server should send a text event");
        };
        serde_json::from_str(&event_text).expect("the event should be json")
    }

    async fn receive_binary(socket: &mut ClientSocket) -> Vec<u8> {
        let received_message = socket
            .next()
            .await
            .expect("the server should send a packet")
            .expect("the packet should be valid");
        let ClientMessage::Binary(payload) = received_message else {
            panic!("the server should send a binary packet");
        };
        payload.to_vec()
    }

    async fn receive_close(socket: &mut ClientSocket) -> (u16, String) {
        loop {
            let received_message = socket
                .next()
                .await
                .expect("the server should close the socket")
                .expect("the close frame should be valid");
            if let ClientMessage::Close(Some(frame)) = received_message {
                return (u16::from(frame.code), frame.reason.to_string());
            }
        }
    }

    async fn expect_silence(socket: &mut ClientSocket) {
        let quiet = timeout(SILENCE, socket.next()).await;
        assert!(quiet.is_err(), "the server should not answer");
    }

    async fn send_json(socket: &mut ClientSocket, event: Value) {
        socket
            .send(ClientMessage::Text(Utf8Bytes::from(event.to_string())))
            .await
            .expect("the realtime event should send");
    }

    async fn send_packet(socket: &mut ClientSocket, packet: Vec<u8>) {
        socket
            .send(ClientMessage::Binary(packet.into()))
            .await
            .expect("the audio packet should send");
    }

    fn start_message(frame_count: usize) -> Value {
        json!({
            "type": "recording.start",
            "sampleRate": 48000,
            "frameCount": frame_count,
            "latencyFrameCount": 0,
        })
    }

    fn chunk(frame_index: u32, samples: &[f32]) -> Vec<u8> {
        packet::create_chunk(frame_index, samples)
            .expect("the fixture packet should fit the realtime protocol")
    }

    async fn start_recording_room(base: &str) -> (ClientSocket, ClientSocket) {
        let mut owner = connect(base).await;
        let mut listener = connect(base).await;
        send_json(&mut owner, start_message(FRAME_COUNT)).await;
        assert_eq!(
            receive_json(&mut owner).await,
            json!({ "type": "recording.started" })
        );
        assert_eq!(
            receive_json(&mut listener).await,
            json!({ "type": "player.record" })
        );
        assert_eq!(
            receive_json(&mut listener).await,
            json!({ "type": "recording.started" })
        );
        (owner, listener)
    }

    async fn connect_room(base: &str) -> (ClientSocket, ClientSocket) {
        let mut owner = connect(base).await;
        send_json(&mut owner, json!({ "type": "player.play" })).await;
        send_json(
            &mut owner,
            json!({ "type": "player.frameIndex", "source": "user" }),
        )
        .await;
        assert_eq!(
            receive_json(&mut owner).await,
            json!({ "type": "player.revision", "revision": 1 })
        );
        let mut listener = connect(base).await;
        send_json(&mut listener, json!({ "type": "player.sync.request" })).await;
        assert_eq!(
            receive_json(&mut listener).await,
            json!({
                "type": "player.sync.state",
                "active": true,
                "recording": false,
                "frozen": false,
                "frameIndex": 0.0,
                "revision": 1,
            })
        );
        send_json(&mut owner, json!({ "type": "player.stop" })).await;
        assert_eq!(
            receive_json(&mut owner).await,
            json!({ "type": "player.stop" })
        );
        assert_eq!(
            receive_json(&mut listener).await,
            json!({ "type": "player.stop" })
        );
        (owner, listener)
    }

    #[tokio::test]
    async fn records_pcm_and_synchronizes_the_project_room() {
        let workspace = Workspace::new();
        workspace.seed(PROJECT);
        let storage = workspace.create_storage();
        let (base, _server) = start_server(Arc::clone(&storage)).await;
        let (mut owner, mut listener) = start_recording_room(&base).await;

        let samples = [-1.0_f32, 0.5, 1.0, -0.25];
        let expected_packet = chunk(0, &samples);
        send_packet(&mut owner, expected_packet.clone()).await;
        assert_eq!(receive_binary(&mut listener).await, expected_packet);

        let patch = receive_json(&mut owner).await;
        assert_eq!(patch["type"], "recording.peaksChanged");
        assert_eq!(patch["startPeakIndex"], 0);
        let peaks = patch["peaks"]
            .as_array()
            .expect("the peak patch should contain values");
        assert_eq!(peaks.len(), 8);
        assert_eq!(peaks[0], -1.0);
        assert_eq!(peaks[1], 0.0);
        assert_eq!(peaks[4], 0.0);
        assert_eq!(peaks[5], 32767.0 / 32768.0);
        assert_eq!(receive_json(&mut listener).await, patch);

        send_json(&mut owner, json!({ "type": "recording.finish" })).await;
        assert_eq!(
            receive_json(&mut owner).await,
            json!({ "type": "recording.finished" })
        );
        assert_eq!(
            receive_json(&mut listener).await,
            json!({ "type": "recording.finished" })
        );
        let recording = storage
            .database
            .recording(1)
            .expect("the recording should be readable")
            .expect("the recording should be stored");
        let audio = std::fs::read(musetric_db::blob_path(
            &storage.blobs_path,
            &recording.blob_id,
        ))
        .expect("the recording wav should exist");
        assert_eq!(&audio[..4], b"RIFF");
        assert_eq!(&audio[44..46], &(-32768_i16).to_le_bytes());
        assert_eq!(&audio[46..48], &(16383_i16).to_le_bytes());
    }

    #[tokio::test]
    async fn frees_the_player_before_it_rebuilds_the_peaks() {
        let workspace = Workspace::new();
        workspace.seed(PROJECT);
        let (base, _server) = start_server(workspace.create_storage()).await;
        let (owner, mut listener) = start_recording_room(&base).await;

        drop(owner);

        assert_eq!(
            receive_json(&mut listener).await,
            json!({ "type": "player.stop" })
        );
        assert_eq!(
            receive_json(&mut listener).await,
            json!({ "type": "recording.finished" })
        );

        send_json(&mut listener, json!({ "type": "player.play" })).await;
        send_json(&mut listener, json!({ "type": "player.sync.request" })).await;
        assert_eq!(
            receive_json(&mut listener).await,
            json!({
                "type": "player.sync.state",
                "active": true,
                "recording": false,
                "frozen": false,
                "frameIndex": 0.0,
                "revision": 0,
            })
        );
    }

    #[tokio::test]
    async fn ignores_a_second_recorder_while_the_first_one_holds_the_player() {
        let workspace = Workspace::new();
        workspace.seed(PROJECT);
        let (base, _server) = start_server(workspace.create_storage()).await;
        let (mut owner, mut listener) = start_recording_room(&base).await;

        send_json(&mut listener, start_message(FRAME_COUNT)).await;
        assert_eq!(
            receive_json(&mut listener).await,
            json!({
                "type": "player.sync.state",
                "active": true,
                "recording": true,
                "frozen": false,
                "frameIndex": 0.0,
                "revision": 0,
            })
        );
        assert_eq!(
            receive_json(&mut listener).await,
            json!({ "type": "recording.finished" })
        );

        send_packet(&mut listener, chunk(0, &[0.5_f32])).await;
        expect_silence(&mut listener).await;

        send_json(&mut listener, json!({ "type": "recording.finish" })).await;
        assert_eq!(
            receive_json(&mut listener).await,
            json!({ "type": "recording.finished" })
        );

        send_json(&mut owner, json!({ "type": "recording.finish" })).await;
        assert_eq!(
            receive_json(&mut owner).await,
            json!({ "type": "recording.finished" })
        );
    }

    #[tokio::test]
    async fn refuses_a_packet_that_arrives_before_the_recording_starts() {
        let workspace = Workspace::new();
        workspace.seed(PROJECT);
        let (base, _server) = start_server(workspace.create_storage()).await;
        let mut lonely = connect(&base).await;

        send_packet(&mut lonely, chunk(0, &[0.5_f32])).await;

        assert_eq!(
            receive_close(&mut lonely).await,
            (
                1003,
                "Recording packet must follow recording start".to_owned()
            )
        );
    }

    #[tokio::test]
    async fn refuses_a_recording_start_without_a_frame_count() {
        let workspace = Workspace::new();
        workspace.seed(PROJECT);
        let (base, _server) = start_server(workspace.create_storage()).await;
        let mut lonely = connect(&base).await;

        send_json(
            &mut lonely,
            json!({ "type": "recording.start", "sampleRate": 48000 }),
        )
        .await;

        assert_eq!(
            receive_close(&mut lonely).await,
            (1008, "Invalid recording start message".to_owned())
        );
    }

    #[tokio::test]
    async fn refuses_a_project_that_does_not_exist() {
        let workspace = Workspace::new();
        workspace.seed(PROJECT);
        let (base, _server) = start_server(workspace.create_storage()).await;
        let (mut missing, _) = connect_async(realtime_url(&base, 404))
            .await
            .expect("the client should connect");

        assert_eq!(
            receive_close(&mut missing).await,
            (1008, "Project with id 404 not found".to_owned())
        );
    }

    #[tokio::test]
    async fn skips_a_packet_that_starts_past_the_recorded_frames() {
        let workspace = Workspace::new();
        workspace.seed(PROJECT);
        let (base, _server) = start_server(workspace.create_storage()).await;
        let (mut owner, mut listener) = start_recording_room(&base).await;

        send_packet(&mut owner, chunk(64, &[0.5_f32])).await;
        expect_silence(&mut listener).await;

        let expected_packet = chunk(0, &[0.25_f32]);
        send_packet(&mut owner, expected_packet.clone()).await;
        assert_eq!(receive_binary(&mut listener).await, expected_packet);
    }

    #[tokio::test]
    async fn reuses_the_frames_the_first_recording_reserved() {
        let workspace = Workspace::new();
        workspace.seed(PROJECT);
        let storage = workspace.create_storage();
        let (base, _server) = start_server(Arc::clone(&storage)).await;
        let (mut owner, mut listener) = start_recording_room(&base).await;

        send_json(&mut owner, json!({ "type": "recording.finish" })).await;
        assert_eq!(
            receive_json(&mut owner).await,
            json!({ "type": "recording.finished" })
        );
        assert_eq!(
            receive_json(&mut listener).await,
            json!({ "type": "recording.finished" })
        );
        let reserved = storage
            .database
            .recording(1)
            .expect("the recording should be readable")
            .expect("the recording should be stored");

        send_json(&mut owner, start_message(FRAME_COUNT * 2)).await;
        assert_eq!(
            receive_json(&mut owner).await,
            json!({ "type": "recording.started" })
        );
        assert_eq!(
            receive_json(&mut listener).await,
            json!({ "type": "recording.started" })
        );

        let samples = [0.25_f32; FRAME_COUNT * 2];
        send_packet(&mut owner, chunk(0, &samples)).await;
        assert_eq!(
            receive_binary(&mut listener).await,
            chunk(0, &samples[..FRAME_COUNT])
        );

        let reused = storage
            .database
            .recording(1)
            .expect("the recording should be readable")
            .expect("the recording should be stored");
        assert_eq!(reused.blob_id, reserved.blob_id);
        assert_eq!(reused.wave_blob_id, reserved.wave_blob_id);
        assert_eq!(
            usize::try_from(reused.frame_count).expect("the frame count should be positive"),
            FRAME_COUNT
        );
    }

    #[tokio::test]
    async fn synchronizes_player_revisions_between_room_members() {
        let workspace = Workspace::new();
        workspace.seed(PROJECT);
        let (base, _server) = start_server(workspace.create_storage()).await;
        let (mut owner, mut listener) = connect_room(&base).await;

        send_json(&mut owner, json!({ "type": "player.play" })).await;
        assert_eq!(
            receive_json(&mut listener).await,
            json!({ "type": "player.play" })
        );

        send_json(
            &mut owner,
            json!({
                "type": "player.frameIndex",
                "frameIndex": 123.5,
                "frozen": true,
                "revision": 0,
                "source": "user",
            }),
        )
        .await;
        assert_eq!(
            receive_json(&mut owner).await,
            json!({ "type": "player.revision", "revision": 2 })
        );
        assert_eq!(
            receive_json(&mut listener).await,
            json!({
                "type": "player.frameIndex",
                "frameIndex": 123.5,
                "frozen": true,
                "revision": 2,
                "source": "user",
            })
        );

        send_json(&mut listener, json!({ "type": "player.sync.request" })).await;
        assert_eq!(
            receive_json(&mut listener).await,
            json!({
                "type": "player.sync.state",
                "active": true,
                "recording": false,
                "frozen": true,
                "frameIndex": 123.5,
                "revision": 2,
            })
        );

        send_json(
            &mut listener,
            json!({
                "type": "player.frameIndex",
                "frameIndex": 1,
                "frozen": false,
                "revision": 2,
                "source": "playback",
            }),
        )
        .await;
        assert_eq!(
            receive_json(&mut listener).await,
            json!({
                "type": "player.sync.state",
                "active": true,
                "recording": false,
                "frozen": true,
                "frameIndex": 123.5,
                "revision": 2,
            })
        );

        send_json(&mut owner, json!({ "type": "player.stop" })).await;
        assert_eq!(
            receive_json(&mut owner).await,
            json!({ "type": "player.stop" })
        );
        assert_eq!(
            receive_json(&mut listener).await,
            json!({ "type": "player.stop" })
        );
    }
}
