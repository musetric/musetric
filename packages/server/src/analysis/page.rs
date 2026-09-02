use axum::{
    body::Body,
    http::{Method, Request, StatusCode, header::CONTENT_TYPE},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};

use crate::proxy::{ProxyState, forward};

const PAGE_ROUTE: &str = "/api/internal/gpu/page";
const CONTENT_TYPE_JSON: &str = "application/json";

pub(crate) struct OpenedPage {
    page_id: String,
}

pub(crate) enum PageFailure {
    Refused(String),
    Unreachable,
}

pub(crate) async fn open_page(proxy: &ProxyState, url: &str) -> Result<OpenedPage, PageFailure> {
    let payload = json!({ "url": url });
    let built = Request::builder()
        .method(Method::POST)
        .uri(PAGE_ROUTE)
        .header(CONTENT_TYPE, CONTENT_TYPE_JSON)
        .body(Body::from(payload.to_string()));
    let Ok(request) = built else {
        return Err(PageFailure::Unreachable);
    };
    let response = forward(proxy, request).await;
    let status = response.status();
    let body = read_body(response.into_body()).await;
    if status == StatusCode::BAD_GATEWAY {
        return Err(PageFailure::Unreachable);
    }
    if status != StatusCode::OK {
        return Err(PageFailure::Refused(read_message(&body, status)));
    }
    let found = serde_json::from_slice::<Value>(&body)
        .ok()
        .and_then(|answer| answer.get("pageId")?.as_str().map(ToOwned::to_owned));
    found
        .map(|page_id| OpenedPage { page_id })
        .ok_or(PageFailure::Unreachable)
}

pub(crate) async fn close_page(proxy: &ProxyState, page: &OpenedPage) {
    let built = Request::builder()
        .method(Method::DELETE)
        .uri(format!("{PAGE_ROUTE}/{}", page.page_id))
        .body(Body::empty());
    if let Ok(request) = built {
        let _ = forward(proxy, request).await;
    }
}

async fn read_body(body: Body) -> Vec<u8> {
    body.collect()
        .await
        .map(|collected| collected.to_bytes().to_vec())
        .unwrap_or_default()
}

fn read_message(body: &[u8], status: StatusCode) -> String {
    serde_json::from_slice::<Value>(body)
        .ok()
        .and_then(|answer| answer.get("message")?.as_str().map(ToOwned::to_owned))
        .unwrap_or_else(|| format!("The gpu page was refused with {status}"))
}
