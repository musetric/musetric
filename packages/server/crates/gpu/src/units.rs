use std::{future::Future, path::PathBuf, pin::Pin, sync::Arc};

use axum::{
    body::{Body, Bytes},
    extract::Request,
    http::{HeaderValue, StatusCode, header::CACHE_CONTROL, header::CONTENT_TYPE},
    response::{IntoResponse, Response},
};
use http_body_util::BodyExt;
use tokio::{
    fs::{self, File, create_dir_all},
    io::AsyncWriteExt,
};

use crate::{
    files::{NO_STORE, OCTET_STREAM},
    host::HostState,
};

const FLOAT_BYTES: usize = 4;

pub type UnitCompleted<'session> =
    Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'session>>;

pub struct UnitWrite {
    part: PathBuf,
    ready: PathBuf,
    expected: u64,
}

impl UnitWrite {
    #[must_use]
    pub fn create(part: PathBuf, ready: PathBuf, expected: u64) -> Self {
        Self {
            part,
            ready,
            expected,
        }
    }
}

pub enum UnitTarget {
    Confirm,
    Compare { ready: PathBuf },
    Write(UnitWrite),
}

pub enum UnitReject {
    Stale,
    Bad(String),
}

pub trait UnitSession: Send + Sync {
    fn window(&self, attempt: &str, unit: u32) -> Result<Bytes, UnitReject>;
    fn target(&self, attempt: &str, unit: u32, output: &str) -> Result<UnitTarget, UnitReject>;
    fn completed<'a>(&'a self, attempt: &'a str, unit: u32, output: &'a str) -> UnitCompleted<'a>;
    fn aborted(&self, attempt: &str, unit: u32, output: &str);
    fn opened(&self, attempt: &str) -> Result<(), String>;
    fn done(&self, attempt: &str, unit: u32) -> Result<(), String>;
}

pub(crate) struct UnitOutput<'route> {
    units: Option<Arc<dyn UnitSession>>,
    attempt: &'route str,
    unit: u32,
    output: &'route str,
}

impl<'route> UnitOutput<'route> {
    pub(crate) fn create(
        state: &'route Arc<HostState>,
        attempt: &'route str,
        unit: u32,
        output: &'route str,
    ) -> UnitOutput<'route> {
        Self {
            units: state.units(),
            attempt,
            unit,
            output,
        }
    }
}

struct OutputContext<'route> {
    units: Arc<dyn UnitSession>,
    attempt: &'route str,
    unit: u32,
    output: &'route str,
}

enum OutputFailure {
    Length,
    Corrupt,
    Mismatch,
    Interrupted,
    Storage(String),
}

pub(crate) fn receive_window(state: &Arc<HostState>, attempt: &str, unit: u32) -> Response {
    let Some(units) = state.units() else {
        return refused_transport();
    };
    match units.window(attempt, unit) {
        Ok(window) => {
            let mut response = Response::new(Body::from(window));
            let headers = response.headers_mut();
            headers.insert(CONTENT_TYPE, HeaderValue::from_static(OCTET_STREAM));
            headers.insert(CACHE_CONTROL, HeaderValue::from_static(NO_STORE));
            response
        }
        Err(reject) => reject_response(reject),
    }
}

pub(crate) async fn receive_output(route: UnitOutput<'_>, request: Request) -> Response {
    let Some(units) = route.units else {
        return refused_transport();
    };
    let context = OutputContext {
        units,
        attempt: route.attempt,
        unit: route.unit,
        output: route.output,
    };
    let target = match context
        .units
        .target(context.attempt, context.unit, context.output)
    {
        Ok(target) => target,
        Err(reject) => return reject_response(reject),
    };
    let stored = match target {
        UnitTarget::Confirm => Ok(()),
        UnitTarget::Compare { ready } => verify_output(&context, ready, request.into_body()).await,
        UnitTarget::Write(write) => store_output(&context, write, request.into_body()).await,
    };
    match stored {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(failure) => failure_response(failure),
    }
}

fn refused_transport() -> Response {
    (StatusCode::NOT_FOUND, "the unit transport is not attached").into_response()
}

fn reject_response(reject: UnitReject) -> Response {
    match reject {
        UnitReject::Stale => {
            (StatusCode::CONFLICT, "the unit attempt is not active").into_response()
        }
        UnitReject::Bad(reason) => (StatusCode::BAD_REQUEST, reason).into_response(),
    }
}

fn failure_response(failure: OutputFailure) -> Response {
    match failure {
        OutputFailure::Length => (
            StatusCode::BAD_REQUEST,
            "the unit output has an unexpected length",
        )
            .into_response(),
        OutputFailure::Corrupt => (
            StatusCode::BAD_REQUEST,
            "the unit output carries non-finite samples",
        )
            .into_response(),
        OutputFailure::Mismatch => (
            StatusCode::CONFLICT,
            "the repeated unit output carries other bytes",
        )
            .into_response(),
        OutputFailure::Interrupted => {
            (StatusCode::BAD_REQUEST, "the unit output was interrupted").into_response()
        }
        OutputFailure::Storage(reason) => {
            (StatusCode::INTERNAL_SERVER_ERROR, reason).into_response()
        }
    }
}

async fn verify_output(
    context: &OutputContext<'_>,
    ready: PathBuf,
    body: Body,
) -> Result<(), OutputFailure> {
    let stored = fs::read(&ready)
        .await
        .map_err(|error| OutputFailure::Storage(error.to_string()))?;
    let outcome = compare_body(&stored, body).await;
    if outcome.is_err() {
        context
            .units
            .aborted(context.attempt, context.unit, context.output);
    }
    outcome
}

async fn compare_body(stored: &[u8], mut body: Body) -> Result<(), OutputFailure> {
    let mut offset = 0_usize;
    while let Some(received) = body.frame().await {
        let frame = received.map_err(|_| OutputFailure::Interrupted)?;
        if let Some(chunk) = frame.data_ref() {
            let end = offset + chunk.len();
            if end > stored.len() || &stored[offset..end] != chunk.as_ref() {
                return Err(OutputFailure::Mismatch);
            }
            offset = end;
        }
    }
    if offset != stored.len() {
        return Err(OutputFailure::Mismatch);
    }
    Ok(())
}

async fn store_output(
    context: &OutputContext<'_>,
    write: UnitWrite,
    body: Body,
) -> Result<(), OutputFailure> {
    if let Err(failure) = write_part(&write.part, write.expected, body).await {
        context
            .units
            .aborted(context.attempt, context.unit, context.output);
        let _ = fs::remove_file(&write.part).await;
        return Err(failure);
    }
    if let Err(failure) = promote_part(&write.part, &write.ready).await {
        context
            .units
            .aborted(context.attempt, context.unit, context.output);
        return Err(failure);
    }
    if let Err(error) = context
        .units
        .completed(context.attempt, context.unit, context.output)
        .await
    {
        return Err(OutputFailure::Storage(error));
    }
    Ok(())
}

async fn promote_part(part: &PathBuf, ready: &PathBuf) -> Result<(), OutputFailure> {
    if let Some(directory) = ready.parent()
        && let Err(error) = create_dir_all(directory).await
    {
        return Err(OutputFailure::Storage(error.to_string()));
    }
    fs::rename(part, ready)
        .await
        .map_err(|error| OutputFailure::Storage(error.to_string()))
}

async fn write_part(part: &PathBuf, expected: u64, mut body: Body) -> Result<(), OutputFailure> {
    if let Some(directory) = part.parent()
        && let Err(error) = create_dir_all(directory).await
    {
        return Err(OutputFailure::Storage(error.to_string()));
    }
    let mut file = File::create(part)
        .await
        .map_err(|error| OutputFailure::Storage(error.to_string()))?;
    let mut carry: Vec<u8> = Vec::new();
    let mut written = 0_u64;
    while let Some(received) = body.frame().await {
        let frame = received.map_err(|_| OutputFailure::Interrupted)?;
        let Some(chunk) = frame.data_ref() else {
            continue;
        };
        carry.extend_from_slice(chunk.as_ref());
        let aligned = carry.len() - carry.len() % FLOAT_BYTES;
        if written + aligned as u64 > expected {
            return Err(OutputFailure::Length);
        }
        write_samples(&mut file, &carry[..aligned], &mut written).await?;
        carry.drain(..aligned);
    }
    if !carry.is_empty() || written != expected {
        return Err(OutputFailure::Length);
    }
    file.flush()
        .await
        .map_err(|error| OutputFailure::Storage(error.to_string()))
}

async fn write_samples(
    file: &mut File,
    bytes: &[u8],
    written: &mut u64,
) -> Result<(), OutputFailure> {
    for value in bytes.chunks_exact(FLOAT_BYTES) {
        if let Some(raw) = value.first_chunk::<4>()
            && !f32::from_le_bytes(*raw).is_finite()
        {
            return Err(OutputFailure::Corrupt);
        }
    }
    file.write_all(bytes)
        .await
        .map_err(|error| OutputFailure::Storage(error.to_string()))?;
    *written += bytes.len() as u64;
    Ok(())
}
