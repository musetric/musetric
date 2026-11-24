use std::{
    fmt,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, SyncSender},
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use wasapi::{
    AudioCaptureClient, AudioClient, AudioClientProperties, AudioClock, Device, DeviceEnumerator,
    DeviceEventCallbacks, DeviceEventRegistration, Direction, Handle, SampleType, StreamMode,
    StreamOption, WasapiError, WaveFormat, deinitialize, initialize_mta,
};

use super::{
    chunk::Packet,
    system::{
        CaptureSystem, ChangeSink, Input, Inputs, MICROPHONE_ACCESS_DENIED, OpenRequest, Opened,
        PacketSink, clock_ms,
    },
};

const DEFAULT_DEVICE: &str = "default";
const BUFFER_HNS: i64 = 2_000_000;
const WAIT_MS: u32 = 100;
const HNS_PER_MS: f64 = 10_000.0;
const CLOCK_SPINS: usize = 3;
const CLOCK_DEADLINE: Duration = Duration::from_millis(200);
const CLOCK_STALLED: &str = "the microphone clock did not advance";
const BITS_PER_SAMPLE: usize = 32;
const BYTES_PER_SAMPLE: usize = size_of::<f32>();
const ACCESS_DENIED: i32 = 0x8007_0005_u32.cast_signed();
const CAPTURE_THREAD: &str = "musetric-microphone";
const WATCH_THREAD: &str = "musetric-microphone-watch";
const THREAD_LOST: &str = "the microphone thread stopped before it opened the device";

pub(crate) struct Wasapi;

pub(crate) struct WasapiStream {
    running: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Drop for WasapiStream {
    fn drop(&mut self) {
        self.running.store(false, Ordering::Release);
        if let Some(thread) = self.thread.take()
            && thread.join().is_err()
        {
            log::error!("the microphone thread panicked");
        }
    }
}

pub(crate) struct WasapiWatch {
    stop: Option<mpsc::Sender<()>>,
    thread: Option<JoinHandle<()>>,
}

impl Drop for WasapiWatch {
    fn drop(&mut self) {
        drop(self.stop.take());
        if let Some(thread) = self.thread.take()
            && thread.join().is_err()
        {
            log::error!("the microphone device watch panicked");
        }
    }
}

struct OpenedDevice {
    id: String,
    raw: bool,
}

enum Failure {
    Wasapi(WasapiError),
    Stalled,
}

impl From<WasapiError> for Failure {
    fn from(error: WasapiError) -> Self {
        Self::Wasapi(error)
    }
}

impl fmt::Display for Failure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Wasapi(WasapiError::Windows(windows)) if windows.code().0 == ACCESS_DENIED => {
                formatter.write_str(MICROPHONE_ACCESS_DENIED)
            }
            Self::Wasapi(error) => error.fmt(formatter),
            Self::Stalled => formatter.write_str(CLOCK_STALLED),
        }
    }
}

struct CounterClock {
    offset_ms: f64,
}

#[expect(
    clippy::cast_precision_loss,
    reason = "the performance counter in 100 ns units stays below 2^53 for decades of uptime"
)]
fn ticks_ms(ticks: u64) -> f64 {
    ticks as f64 / HNS_PER_MS
}

impl CounterClock {
    fn spin(clock: &AudioClock) -> Result<f64, Failure> {
        let (_, first) = clock.get_position()?;
        let deadline = Instant::now() + CLOCK_DEADLINE;
        loop {
            let (_, ticks) = clock.get_position()?;
            let after = Instant::now();
            if ticks != first {
                return Ok(clock_ms(after) - ticks_ms(ticks));
            }
            if after > deadline {
                return Err(Failure::Stalled);
            }
        }
    }

    fn measure(clock: &AudioClock) -> Result<Self, Failure> {
        let mut offset_ms = Self::spin(clock)?;
        for _ in 1..CLOCK_SPINS {
            offset_ms = offset_ms.min(Self::spin(clock)?);
        }
        Ok(Self { offset_ms })
    }

    fn to_ms(&self, ticks: u64) -> f64 {
        ticks_ms(ticks) + self.offset_ms
    }
}

#[derive(Default)]
struct Buffers {
    bytes: Vec<u8>,
    samples: Vec<f32>,
}

struct Capture {
    client: AudioClient,
    reader: AudioCaptureClient,
    event: Handle,
    clock: CounterClock,
}

fn in_com<T>(work: impl FnOnce() -> T) -> T {
    let initialized = initialize_mta().is_ok();
    let result = work();
    if initialized {
        deinitialize();
    }
    result
}

fn read_inputs() -> Result<Inputs, Failure> {
    let enumerator = DeviceEnumerator::new()?;
    let collection = enumerator.get_device_collection(Direction::Capture)?;
    let mut inputs = Vec::new();
    for listed in &collection {
        let device = listed?;
        inputs.push(Input {
            id: device.get_id()?,
            label: device.get_friendlyname()?,
        });
    }
    let default_input = enumerator
        .get_default_device(Direction::Capture)
        .and_then(|device| device.get_id())
        .ok();
    Ok(Inputs {
        inputs,
        default_input,
    })
}

fn initialize(device: &Device, format: &WaveFormat, raw: bool) -> Result<AudioClient, Failure> {
    let mut client = device.get_iaudioclient()?;
    if raw {
        client.set_properties(AudioClientProperties::new().set_option(StreamOption::Raw))?;
    }
    client.initialize_client(
        format,
        Direction::Capture,
        StreamMode::EventsShared {
            autoconvert: true,
            buffer_duration_hns: BUFFER_HNS,
        },
        None,
    )?;
    Ok(client)
}

impl Capture {
    fn open(request: &OpenRequest) -> Result<(Self, OpenedDevice), Failure> {
        let enumerator = DeviceEnumerator::new()?;
        let device = match request.device_id.as_deref() {
            None | Some("" | DEFAULT_DEVICE) => {
                enumerator.get_default_device(Direction::Capture)?
            }
            Some(id) => enumerator.get_device(id)?,
        };
        let format = WaveFormat::new(
            BITS_PER_SAMPLE,
            BITS_PER_SAMPLE,
            SampleType::Float,
            request.sample_rate as usize,
            1,
            None,
        );
        let (client, raw) = match initialize(&device, &format, true) {
            Ok(client) => (client, true),
            Err(error) => {
                log::warn!("the microphone opens without its raw mode: {error}");
                (initialize(&device, &format, false)?, false)
            }
        };
        let event = client.set_get_eventhandle()?;
        let reader = client.get_audiocaptureclient()?;
        client.start_stream()?;
        let clock = CounterClock::measure(&client.get_audioclock()?)?;
        let opened = OpenedDevice {
            id: device.get_id()?,
            raw,
        };
        Ok((
            Self {
                client,
                reader,
                event,
                clock,
            },
            opened,
        ))
    }

    fn pump(&self, sink: &mut PacketSink, running: &AtomicBool) -> Result<(), Failure> {
        let mut buffers = Buffers::default();
        while running.load(Ordering::Acquire) {
            if self.event.wait_for_event(WAIT_MS).is_err() {
                continue;
            }
            while let Some(frames) = self
                .reader
                .get_next_packet_size()?
                .filter(|frames| *frames > 0)
            {
                self.read(frames, &mut buffers, sink)?;
            }
        }
        Ok(())
    }

    fn read(
        &self,
        frames: u32,
        buffers: &mut Buffers,
        sink: &mut PacketSink,
    ) -> Result<(), Failure> {
        buffers.bytes.resize(frames as usize * BYTES_PER_SAMPLE, 0);
        let (read, info) = self.reader.read_from_device(&mut buffers.bytes)?;
        let (samples, _) = buffers.bytes.as_chunks::<BYTES_PER_SAMPLE>();
        buffers.samples.clear();
        buffers.samples.extend(
            samples
                .iter()
                .take(read as usize)
                .map(|sample| f32::from_le_bytes(*sample)),
        );
        sink(&Packet {
            capture_ms: (!info.flags.timestamp_error).then(|| self.clock.to_ms(info.timestamp)),
            discontinuity: info.flags.data_discontinuity,
            samples: &buffers.samples,
        });
        Ok(())
    }
}

fn capture(
    request: &OpenRequest,
    mut sink: PacketSink,
    running: &AtomicBool,
    ready: &SyncSender<Result<OpenedDevice, String>>,
) {
    let (capture, opened) = match Capture::open(request) {
        Ok(opened) => opened,
        Err(error) => {
            let _ = ready.send(Err(error.to_string()));
            return;
        }
    };
    let _ = ready.send(Ok(opened));
    if let Err(error) = capture.pump(&mut sink, running) {
        log::error!("the microphone stopped: {error}");
    }
    if let Err(error) = capture.client.stop_stream() {
        log::error!("could not stop the microphone: {error}");
    }
}

fn register(on_change: ChangeSink) -> Result<DeviceEventRegistration, Failure> {
    let notify: Arc<dyn Fn() + Send + Sync> = Arc::from(on_change);
    let mut callbacks = DeviceEventCallbacks::new();
    let added = Arc::clone(&notify);
    callbacks.set_device_added_callback(move |_| added());
    let removed = Arc::clone(&notify);
    callbacks.set_device_removed_callback(move |_| removed());
    let state = Arc::clone(&notify);
    callbacks.set_device_state_callback(move |_, _| state());
    callbacks.set_default_device_callback(move |direction, _, _| {
        if direction == Direction::Capture {
            notify();
        }
    });
    Ok(DeviceEnumerator::new()?.register_notification_callback(callbacks)?)
}

fn watch_devices(
    on_change: ChangeSink,
    ready: &SyncSender<Result<(), String>>,
    stopped: &Receiver<()>,
) {
    match register(on_change) {
        Ok(registration) => {
            let _ = ready.send(Ok(()));
            let _ = stopped.recv();
            drop(registration);
        }
        Err(error) => {
            let _ = ready.send(Err(error.to_string()));
        }
    }
}

impl CaptureSystem for Wasapi {
    type Stream = WasapiStream;
    type Watch = WasapiWatch;

    fn inputs() -> Result<Inputs, String> {
        in_com(read_inputs).map_err(|error| error.to_string())
    }

    fn open(request: OpenRequest, sink: PacketSink) -> Result<Opened<WasapiStream>, String> {
        let (ready_sender, ready) = mpsc::sync_channel(1);
        let running = Arc::new(AtomicBool::new(true));
        let thread_running = Arc::clone(&running);
        let thread = thread::Builder::new()
            .name(CAPTURE_THREAD.to_owned())
            .spawn(move || in_com(|| capture(&request, sink, &thread_running, &ready_sender)))
            .map_err(|error| error.to_string())?;
        let stream = WasapiStream {
            running,
            thread: Some(thread),
        };
        let opened = ready.recv().map_err(|_| THREAD_LOST.to_owned())??;
        Ok(Opened {
            stream,
            device_id: opened.id,
            raw: opened.raw,
        })
    }

    fn watch(on_change: ChangeSink) -> Result<WasapiWatch, String> {
        let (stop, stopped) = mpsc::channel();
        let (ready_sender, ready) = mpsc::sync_channel(1);
        let thread = thread::Builder::new()
            .name(WATCH_THREAD.to_owned())
            .spawn(move || in_com(|| watch_devices(on_change, &ready_sender, &stopped)))
            .map_err(|error| error.to_string())?;
        let watch = WasapiWatch {
            stop: Some(stop),
            thread: Some(thread),
        };
        ready.recv().map_err(|_| THREAD_LOST.to_owned())??;
        Ok(watch)
    }
}
