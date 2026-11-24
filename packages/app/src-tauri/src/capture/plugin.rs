use std::{
    sync::{Mutex, MutexGuard},
    time::Instant,
};

use serde::Serialize;
use tauri::{
    AppHandle, Manager, Runtime,
    ipc::{Channel, InvokeResponseBody},
    plugin::{Builder, TauriPlugin},
};

use super::{
    chunk::ChunkFramer,
    system::{CaptureSystem, Inputs, OpenRequest, PacketSink, clock_ms},
    windows::Wasapi,
};

type System = Wasapi;

const PLUGIN_NAME: &str = "microphone";
const CHUNKS_PER_SECOND: u32 = 50;
const POISONED: &str = "the microphone state is poisoned";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Started {
    session: u32,
    device_id: String,
    chunk_seconds: f64,
    raw: bool,
}

#[derive(Default)]
struct Session {
    count: u32,
    stream: Option<<System as CaptureSystem>::Stream>,
    watch: Option<<System as CaptureSystem>::Watch>,
}

#[derive(Default)]
struct Microphone(Mutex<Session>);

fn send_chunk(channel: &Channel<InvokeResponseBody>, bytes: Vec<u8>) {
    if let Err(error) = channel.send(InvokeResponseBody::Raw(bytes)) {
        log::error!("could not send a microphone chunk: {error}");
    }
}

impl Microphone {
    fn session(&self) -> Result<MutexGuard<'_, Session>, String> {
        self.0.lock().map_err(|_| POISONED.to_owned())
    }

    fn start(
        &self,
        request: OpenRequest,
        on_chunk: Channel<InvokeResponseBody>,
    ) -> Result<Started, String> {
        let mut session = self.session()?;
        session.stream = None;
        session.count = session.count.wrapping_add(1);
        let count = session.count;
        let sample_rate = request.sample_rate;
        let mut framer = ChunkFramer::new(
            count,
            sample_rate,
            (sample_rate / CHUNKS_PER_SECOND) as usize,
        );
        let sink: PacketSink = Box::new(move |packet| {
            framer.push(packet, &mut |bytes| send_chunk(&on_chunk, bytes));
        });
        let opened = System::open(request, sink)?;
        log::info!("microphone opened: raw={}", opened.raw);
        session.stream = Some(opened.stream);
        Ok(Started {
            session: count,
            device_id: opened.device_id,
            chunk_seconds: 1.0 / f64::from(CHUNKS_PER_SECOND),
            raw: opened.raw,
        })
    }

    fn stop(&self) -> Result<(), String> {
        self.session()?.stream = None;
        Ok(())
    }

    fn watch(&self, on_change: Channel<()>) -> Result<(), String> {
        let mut session = self.session()?;
        session.watch = None;
        session.watch = Some(System::watch(Box::new(move || {
            if let Err(error) = on_change.send(()) {
                log::error!("could not report a change of the audio devices: {error}");
            }
        }))?);
        Ok(())
    }
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
fn clock() -> f64 {
    clock_ms(Instant::now())
}

#[tauri::command]
async fn devices() -> Result<Inputs, String> {
    blocking(System::inputs).await
}

#[tauri::command]
async fn start<R: Runtime>(
    app: AppHandle<R>,
    device_id: Option<String>,
    sample_rate: u32,
    on_chunk: Channel<InvokeResponseBody>,
) -> Result<Started, String> {
    blocking(move || {
        app.state::<Microphone>().start(
            OpenRequest {
                device_id,
                sample_rate,
            },
            on_chunk,
        )
    })
    .await
}

#[tauri::command]
async fn stop<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    blocking(move || app.state::<Microphone>().stop()).await
}

#[tauri::command]
async fn watch<R: Runtime>(app: AppHandle<R>, on_change: Channel<()>) -> Result<(), String> {
    blocking(move || app.state::<Microphone>().watch(on_change)).await
}

pub(crate) fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new(PLUGIN_NAME)
        .invoke_handler(tauri::generate_handler![clock, devices, start, stop, watch])
        .setup(|app, _| {
            app.manage(Microphone::default());
            Ok(())
        })
        .build()
}
