use std::{
    mem,
    sync::{
        Arc, Mutex, MutexGuard, PoisonError,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use objc2_core_audio::{
    AudioObjectPropertySelector, kAudioDeviceTransportTypeBluetooth,
    kAudioDeviceTransportTypeBluetoothLE, kAudioHardwarePropertyDefaultInputDevice,
    kAudioHardwarePropertyDefaultOutputDevice, kAudioHardwarePropertyDevices, kAudioObjectUnknown,
};
use objc2_core_audio_types::AudioTimeStampFlags;

use super::{
    chunk::Packet,
    coreaudio::{
        AudioError, Device, Input, InputProc, Permission, Scope, SystemListener, channels,
        current_host_time, device_of_uid, host_time_ms, input_format, name, record_permission,
        request_record_permission, system_device, system_devices, transport, uid,
    },
    system::{
        CaptureSystem, ChangeSink, Devices, MICROPHONE_ACCESS_DENIED, OpenRequest, Opened,
        PacketSink, Port, SinkForRate, clock_ms,
    },
};

const DEFAULT_DEVICE: &str = "default";
const BLUETOOTH_SUFFIX: &str = " (Bluetooth)";
const DEVICE_GONE: &str = "the microphone is not connected";
const NO_RATE: &str = "the microphone reports no sample rate";
const THREAD_LOST: &str = "the microphone thread could not start";
const CAPTURE_THREAD: &str = "musetric-microphone";
const DRAIN_INTERVAL: Duration = Duration::from_millis(10);
const BUFFERED_SECONDS: usize = 2;
const BUFFERED_MARKS: usize = 4096;
const CLOCK_PROBES: usize = 5;
const MS_PER_SECOND: f64 = 1000.0;
const WATCHED: [AudioObjectPropertySelector; 3] = [
    kAudioHardwarePropertyDevices,
    kAudioHardwarePropertyDefaultInputDevice,
    kAudioHardwarePropertyDefaultOutputDevice,
];

pub(crate) struct CoreAudio;

type Handler = Box<dyn Fn(&Input<'_>) + Send + Sync>;

pub(crate) struct CoreAudioStream {
    input: Option<InputProc<Handler>>,
    running: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Drop for CoreAudioStream {
    fn drop(&mut self) {
        drop(self.input.take());
        self.running.store(false, Ordering::Release);
        if let Some(thread) = self.thread.take()
            && thread.join().is_err()
        {
            log::error!("the microphone thread panicked");
        }
    }
}

pub(crate) struct CoreAudioWatch {
    _listener: SystemListener<ChangeSink>,
}

struct HostClock {
    offset_ms: f64,
}

impl HostClock {
    fn measure() -> Self {
        let mut narrowest = Duration::MAX;
        let mut offset_ms = 0.0;
        for _ in 0..CLOCK_PROBES {
            let before = Instant::now();
            let host = current_host_time();
            let after = Instant::now();
            if after - before < narrowest {
                narrowest = after - before;
                offset_ms = f64::midpoint(clock_ms(before), clock_ms(after)) - host_time_ms(host);
            }
        }
        Self { offset_ms }
    }

    fn to_ms(&self, host_time: u64) -> f64 {
        host_time_ms(host_time) + self.offset_ms
    }
}

struct Mark {
    frames: usize,
    capture_ms: Option<f64>,
    discontinuity: bool,
}

struct Batch {
    samples: Vec<f32>,
    marks: Vec<Mark>,
}

impl Batch {
    fn with_capacity(frames: usize) -> Self {
        Self {
            samples: Vec::with_capacity(frames),
            marks: Vec::with_capacity(BUFFERED_MARKS),
        }
    }

    fn has_room(&self, frames: usize) -> bool {
        self.samples.len() + frames <= self.samples.capacity()
            && self.marks.len() < self.marks.capacity()
    }

    fn send(&mut self, sink: &mut PacketSink) {
        let mut start = 0;
        for mark in &self.marks {
            let end = start + mark.frames;
            if let Some(samples) = self.samples.get(start..end) {
                sink(&Packet {
                    capture_ms: mark.capture_ms,
                    discontinuity: mark.discontinuity,
                    samples,
                });
            }
            start = end;
        }
        self.samples.clear();
        self.marks.clear();
    }
}

struct Pending {
    batch: Batch,
    next_sample_time: Option<f64>,
    lost: bool,
}

struct Ring {
    pending: Mutex<Pending>,
    clock: HostClock,
    latency_ms: f64,
}

#[expect(
    clippy::cast_precision_loss,
    reason = "one cycle of the device holds far fewer frames than f64 represents exactly"
)]
fn frames_as_f64(frames: usize) -> f64 {
    frames as f64
}

impl Ring {
    fn lock(&self) -> MutexGuard<'_, Pending> {
        self.pending.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn write(&self, input: &Input<'_>) {
        let frames = input.samples.len() / input.channels;
        let time = input.time;
        let capture_ms = time
            .mFlags
            .contains(AudioTimeStampFlags::HostTimeValid)
            .then(|| self.clock.to_ms(time.mHostTime) - self.latency_ms);
        let sample_time = time
            .mFlags
            .contains(AudioTimeStampFlags::SampleTimeValid)
            .then_some(time.mSampleTime);
        let mut pending = self.lock();
        let skipped = sample_time
            .zip(pending.next_sample_time)
            .is_some_and(|(at, next)| (at - next).abs() > frames_as_f64(frames) / 2.0);
        pending.next_sample_time = sample_time.map(|at| at + frames_as_f64(frames));
        if !pending.batch.has_room(frames) {
            pending.lost = true;
            return;
        }
        let discontinuity = pending.lost || skipped;
        pending.lost = false;
        pending.batch.samples.extend(
            input
                .samples
                .iter()
                .step_by(input.channels)
                .take(frames)
                .copied(),
        );
        pending.batch.marks.push(Mark {
            frames,
            capture_ms,
            discontinuity,
        });
    }

    fn drain(&self, sink: &mut PacketSink, running: &AtomicBool, frames: usize) {
        let mut taken = Batch::with_capacity(frames);
        while running.load(Ordering::Acquire) {
            thread::sleep(DRAIN_INTERVAL);
            mem::swap(&mut self.lock().batch, &mut taken);
            taken.send(sink);
        }
    }
}

fn label(device: Device) -> Result<String, AudioError> {
    let label = name(device)?;
    let bluetooth = [
        kAudioDeviceTransportTypeBluetooth,
        kAudioDeviceTransportTypeBluetoothLE,
    ]
    .contains(&transport(device)?);
    Ok(if bluetooth {
        format!("{label}{BLUETOOTH_SUFFIX}")
    } else {
        label
    })
}

fn default_uid(selector: AudioObjectPropertySelector) -> Option<String> {
    system_device(selector)
        .ok()
        .filter(|device| *device != kAudioObjectUnknown)
        .and_then(|device| uid(device).ok())
}

fn read_devices() -> Result<Devices, AudioError> {
    let mut inputs = Vec::new();
    let mut outputs = Vec::new();
    for device in system_devices()? {
        let has_input = channels(device, Scope::Input)? > 0;
        let has_output = channels(device, Scope::Output)? > 0;
        if !has_input && !has_output {
            continue;
        }
        let port = Port {
            id: uid(device)?,
            label: label(device)?,
        };
        match (has_input, has_output) {
            (true, true) => {
                outputs.push(port.clone());
                inputs.push(port);
            }
            (true, false) => inputs.push(port),
            (false, _) => outputs.push(port),
        }
    }
    Ok(Devices {
        inputs,
        default_input: default_uid(kAudioHardwarePropertyDefaultInputDevice),
        outputs: Some(outputs),
        default_output: default_uid(kAudioHardwarePropertyDefaultOutputDevice),
    })
}

fn resolve(device_id: Option<&str>) -> Result<Device, String> {
    let device = match device_id {
        None | Some("" | DEFAULT_DEVICE) => system_device(kAudioHardwarePropertyDefaultInputDevice),
        Some(id) => device_of_uid(id),
    }
    .map_err(|error| error.to_string())?;
    if device == kAudioObjectUnknown {
        return Err(DEVICE_GONE.to_owned());
    }
    Ok(device)
}

fn ensure_permission() -> Result<(), String> {
    let granted = match record_permission() {
        Permission::Granted => true,
        Permission::Denied => false,
        Permission::Undetermined => {
            let (answer, answered) = mpsc::channel();
            request_record_permission(move |granted| {
                let _ = answer.send(granted);
            });
            answered.recv().unwrap_or(false)
        }
    };
    if granted {
        Ok(())
    } else {
        Err(MICROPHONE_ACCESS_DENIED.to_owned())
    }
}

#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "a sample rate is rounded to whole hertz and checked to be positive"
)]
fn whole_hertz(sample_rate: f64) -> Result<u32, String> {
    let hertz = sample_rate.round();
    if (1.0..=f64::from(u32::MAX)).contains(&hertz) {
        Ok(hertz as u32)
    } else {
        Err(NO_RATE.to_owned())
    }
}

impl CaptureSystem for CoreAudio {
    type Stream = CoreAudioStream;
    type Watch = CoreAudioWatch;

    fn devices() -> Result<Devices, String> {
        read_devices().map_err(|error| error.to_string())
    }

    fn open(request: OpenRequest, sink: SinkForRate) -> Result<Opened<CoreAudioStream>, String> {
        ensure_permission()?;
        let device = resolve(request.device_id.as_deref())?;
        let device_id = uid(device).map_err(|error| error.to_string())?;
        let format = input_format(device).map_err(|error| error.to_string())?;
        let sample_rate = whole_hertz(format.sample_rate)?;
        let frames = sample_rate as usize * BUFFERED_SECONDS;
        let ring = Arc::new(Ring {
            pending: Mutex::new(Pending {
                batch: Batch::with_capacity(frames),
                next_sample_time: None,
                lost: false,
            }),
            clock: HostClock::measure(),
            latency_ms: f64::from(format.latency_frames) * MS_PER_SECOND / format.sample_rate,
        });
        let running = Arc::new(AtomicBool::new(true));
        let mut packets = sink(sample_rate);
        let drained = Arc::clone(&ring);
        let draining = Arc::clone(&running);
        let thread = thread::Builder::new()
            .name(CAPTURE_THREAD.to_owned())
            .spawn(move || drained.drain(&mut packets, &draining, frames))
            .map_err(|_| THREAD_LOST.to_owned())?;
        let mut stream = CoreAudioStream {
            input: None,
            running,
            thread: Some(thread),
        };
        let handler: Handler = Box::new(move |input| ring.write(input));
        stream.input = Some(InputProc::start(device, handler).map_err(|error| error.to_string())?);
        Ok(Opened {
            stream,
            device_id,
            sample_rate,
            raw: true,
        })
    }

    fn watch(on_change: ChangeSink) -> Result<CoreAudioWatch, String> {
        Ok(CoreAudioWatch {
            _listener: SystemListener::listen(&WATCHED, on_change)
                .map_err(|error| error.to_string())?,
        })
    }
}
