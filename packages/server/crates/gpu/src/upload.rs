use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::Arc,
};

use axum::{
    body::Body,
    extract::Request,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use http_body_util::BodyExt;
use tokio::{
    fs::{File, create_dir_all},
    io::AsyncWriteExt,
    sync::oneshot,
};

use crate::{
    host::{BoxedError, HostState},
    protocol::UPLOAD_ROUTE,
};

pub(crate) struct PendingUpload {
    targets: HashMap<String, PathBuf>,
    remaining: HashSet<String>,
    done: Option<oneshot::Sender<Result<(), String>>>,
}

impl PendingUpload {
    pub(crate) fn create(targets: HashMap<String, PathBuf>) -> (Self, UploadWait) {
        let (sender, receiver) = oneshot::channel();
        let remaining = targets.keys().cloned().collect();
        let upload = Self {
            targets,
            remaining,
            done: Some(sender),
        };
        (upload, UploadWait { receiver })
    }

    pub(crate) fn target(&self, name: &str) -> Option<PathBuf> {
        if !self.remaining.contains(name) {
            return None;
        }
        self.targets.get(name).cloned()
    }

    pub(crate) fn complete(&mut self, name: &str) {
        if !self.remaining.remove(name) {
            return;
        }
        if self.remaining.is_empty()
            && let Some(done) = self.done.take()
        {
            let _ = done.send(Ok(()));
        }
    }

    pub(crate) fn refuse(&mut self, reason: &str) {
        if let Some(done) = self.done.take() {
            let _ = done.send(Err(reason.to_owned()));
        }
    }
}

pub struct UploadWait {
    receiver: oneshot::Receiver<Result<(), String>>,
}

impl UploadWait {
    pub async fn wait(self) -> Result<(), BoxedError> {
        let received = self
            .receiver
            .await
            .map_err(|_| "the gpu executor uploads were dropped")?;
        Ok(received?)
    }
}

pub(crate) async fn receive_upload(
    state: &Arc<HostState>,
    pathname: &str,
    request: Request,
) -> Response {
    let name = decode_name(&pathname[UPLOAD_ROUTE.len()..]);
    let Some(target) = state.take_upload_target(&name) else {
        state.refuse_uploads(&name);
        return (StatusCode::BAD_REQUEST, "unexpected upload").into_response();
    };
    if let Err(error) = write_upload(&target, request.into_body()).await {
        state.refuse_uploads(&name);
        return (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response();
    }
    state.complete_upload(&name);
    StatusCode::NO_CONTENT.into_response()
}

async fn write_upload(target: &Path, mut body: Body) -> Result<(), BoxedError> {
    if let Some(directory) = target.parent() {
        create_dir_all(directory).await?;
    }
    let mut file = File::create(target).await?;
    while let Some(received) = body.frame().await {
        let frame = received?;
        if let Some(chunk) = frame.data_ref() {
            file.write_all(chunk).await?;
        }
    }
    file.flush().await?;
    Ok(())
}

fn decode_name(raw: &str) -> String {
    let mut decoded = String::with_capacity(raw.len());
    let mut letters = raw.chars();
    while let Some(letter) = letters.next() {
        if letter != '%' {
            decoded.push(letter);
            continue;
        }
        let digits: String = letters.by_ref().take(2).collect();
        match u8::from_str_radix(&digits, 16) {
            Ok(byte) => decoded.push(char::from(byte)),
            Err(_) => decoded.push(letter),
        }
    }
    decoded
}
