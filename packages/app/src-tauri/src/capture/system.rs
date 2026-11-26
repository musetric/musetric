use std::{
    sync::OnceLock,
    time::{Duration, Instant},
};

use serde::Serialize;

use super::chunk::Packet;

pub(crate) const MICROPHONE_ACCESS_DENIED: &str = "microphone-access-denied";

const MS_PER_SECOND: f64 = 1000.0;

#[derive(Clone, Serialize)]
pub(crate) struct Port {
    pub(crate) id: String,
    pub(crate) label: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Devices {
    pub(crate) inputs: Vec<Port>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) default_input: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) outputs: Option<Vec<Port>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) default_output: Option<String>,
}

pub(crate) struct OpenRequest {
    pub(crate) device_id: Option<String>,
    pub(crate) sample_rate: u32,
}

pub(crate) struct Opened<S> {
    pub(crate) stream: S,
    pub(crate) device_id: String,
    pub(crate) sample_rate: u32,
    pub(crate) raw: bool,
}

pub(crate) type PacketSink = Box<dyn FnMut(&Packet<'_>) + Send>;

pub(crate) type SinkForRate = Box<dyn FnOnce(u32) -> PacketSink + Send>;

pub(crate) type ChangeSink = Box<dyn Fn() + Send + Sync>;

pub(crate) trait CaptureSystem {
    type Stream: Send;
    type Watch: Send;

    fn devices() -> Result<Devices, String>;

    fn open(request: OpenRequest, sink: SinkForRate) -> Result<Opened<Self::Stream>, String>;

    fn watch(on_change: ChangeSink) -> Result<Self::Watch, String>;
}

fn clock_origin() -> Instant {
    static ORIGIN: OnceLock<Instant> = OnceLock::new();
    *ORIGIN.get_or_init(Instant::now)
}

fn duration_ms(duration: Duration) -> f64 {
    duration.as_secs_f64() * MS_PER_SECOND
}

pub(crate) fn clock_ms(at: Instant) -> f64 {
    let origin = clock_origin();
    if at >= origin {
        duration_ms(at - origin)
    } else {
        -duration_ms(origin - at)
    }
}
