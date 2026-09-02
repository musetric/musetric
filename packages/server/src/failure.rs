use std::fmt::Display;

use axum::{
    body::Body,
    http::{HeaderValue, StatusCode, header::CONTENT_TYPE},
    response::Response,
};

const CONTENT_TYPE_ERROR: &str = "application/json; charset=utf-8";

pub(crate) enum Failure {
    NotFound(String),
    Failed(String),
}

impl Failure {
    pub(crate) fn failed(error: impl Display) -> Self {
        Self::Failed(error.to_string())
    }
}

pub(crate) fn finish(result: Result<Response<Body>, Failure>) -> Response<Body> {
    result.unwrap_or_else(create_failure_response)
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
