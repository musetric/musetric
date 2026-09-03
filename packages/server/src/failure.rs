use std::fmt::Display;

use axum::{
    body::Body,
    http::{HeaderValue, StatusCode, header::CONTENT_TYPE},
    response::Response,
};

const CONTENT_TYPE_ERROR: &str = "application/json; charset=utf-8";

#[derive(Debug)]
pub(crate) enum Failure {
    Invalid(String),
    NotFound(String),
    Failed(String),
}

impl Failure {
    pub(crate) fn failed(error: impl Display) -> Self {
        Self::Failed(error.to_string())
    }
}

pub(crate) fn invalid_number(field: &str) -> Failure {
    Failure::Invalid(format!(
        "params/{field} Invalid input: expected number, received string"
    ))
}

pub(crate) fn invalid_option(location: &str, field: &str, options: &[&str]) -> Failure {
    let listed = options
        .iter()
        .map(|option| format!("\"{option}\""))
        .collect::<Vec<_>>()
        .join("|");
    Failure::Invalid(format!(
        "{location}/{field} Invalid option: expected one of {listed}"
    ))
}

pub(crate) fn finish(result: Result<Response<Body>, Failure>) -> Response<Body> {
    result.unwrap_or_else(create_failure_response)
}

fn create_failure_response(failure: Failure) -> Response<Body> {
    let (status, message) = match failure {
        Failure::Invalid(message) => (StatusCode::BAD_REQUEST, message),
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
