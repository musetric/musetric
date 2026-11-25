use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    body::Body,
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{
            ACCEPT_RANGES, CACHE_CONTROL, CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_RANGE,
            CONTENT_TYPE, ETAG, IF_NONE_MATCH, LAST_MODIFIED,
        },
    },
    response::Response,
};
use musetric_db::BoxedError;
use musetric_gpu::range::PartialRange;
use time::{OffsetDateTime, format_description::BorrowedFormatItem, macros::format_description};

pub(crate) const DOWNLOAD_CACHE: &str = "public, max-age=86400";
pub(crate) const REVALIDATE_CACHE: &str = "public, max-age=0";
const ACCEPT_RANGES_VALUE: &str = "bytes";
const UNRESERVED: &[u8] = b"-_.!~*'()";
const HEX_DIGITS: &[u8; 16] = b"0123456789ABCDEF";
const HTTP_DATE: &[BorrowedFormatItem<'_>] = format_description!(
    "[weekday repr:short], [day] [month repr:short] [year] [hour]:[minute]:[second] GMT"
);

pub(crate) struct CachedFile {
    pub(crate) filename: Option<String>,
    pub(crate) content_type: String,
    pub(crate) cache_control: &'static str,
    pub(crate) size: u64,
    pub(crate) modified: SystemTime,
}

pub(crate) struct CachedHeaders {
    headers: HeaderMap,
    etag: String,
}

impl CachedHeaders {
    pub(crate) fn create(file: &CachedFile) -> Result<Self, BoxedError> {
        let etag = create_etag(file)?;
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_str(&file.content_type)?);
        if let Some(filename) = file.filename.as_ref() {
            let disposition = format!(
                "attachment; filename*=UTF-8''{}",
                encode_uri_component(filename)
            );
            headers.insert(CONTENT_DISPOSITION, HeaderValue::from_str(&disposition)?);
        }
        headers.insert(
            LAST_MODIFIED,
            HeaderValue::from_str(&format_http_date(file.modified)?)?,
        );
        headers.insert(CACHE_CONTROL, HeaderValue::from_static(file.cache_control));
        headers.insert(ETAG, HeaderValue::from_str(&etag)?);
        headers.insert(ACCEPT_RANGES, HeaderValue::from_static(ACCEPT_RANGES_VALUE));
        Ok(Self { headers, etag })
    }

    pub(crate) fn is_not_modified(&self, request: &HeaderMap) -> bool {
        request
            .get(IF_NONE_MATCH)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.split(',').any(|tag| clear_tag(tag) == self.etag))
    }

    pub(crate) fn respond_not_modified(self) -> Response<Body> {
        let mut response = Response::new(Body::empty());
        *response.status_mut() = StatusCode::NOT_MODIFIED;
        *response.headers_mut() = self.headers;
        response
    }

    pub(crate) fn respond(mut self, size: u64, body: Body) -> Response<Body> {
        self.headers.insert(CONTENT_LENGTH, HeaderValue::from(size));
        let mut response = Response::new(body);
        *response.headers_mut() = self.headers;
        response
    }

    pub(crate) fn respond_partial(
        mut self,
        range: PartialRange,
        size: u64,
        body: Body,
    ) -> Result<Response<Body>, BoxedError> {
        let content_range = format!(
            "{ACCEPT_RANGES_VALUE} {}-{}/{}",
            range.start, range.end, size
        );
        self.headers.insert(
            CONTENT_RANGE,
            HeaderValue::from_str(&content_range).map_err(|_| "the content range is invalid")?,
        );
        self.headers.insert(
            CONTENT_LENGTH,
            HeaderValue::from(range.end - range.start + 1),
        );
        let mut response = Response::new(body);
        *response.status_mut() = StatusCode::PARTIAL_CONTENT;
        *response.headers_mut() = self.headers;
        Ok(response)
    }
}

fn create_etag(file: &CachedFile) -> Result<String, BoxedError> {
    let milliseconds = to_milliseconds(file.modified)?;
    let digest = md5::compute(format!("{}:{milliseconds}", file.size));
    Ok(format!("{digest:x}"))
}

#[expect(
    clippy::cast_precision_loss,
    reason = "node builds mtimeMs the same way, and unix seconds stay exact in f64"
)]
fn to_milliseconds(modified: SystemTime) -> Result<f64, BoxedError> {
    let elapsed = modified.duration_since(UNIX_EPOCH)?;
    Ok(elapsed.as_secs() as f64 * 1000.0 + f64::from(elapsed.subsec_nanos()) / 1_000_000.0)
}

fn format_http_date(modified: SystemTime) -> Result<String, BoxedError> {
    let seconds = i64::try_from(modified.duration_since(UNIX_EPOCH)?.as_secs())?;
    Ok(OffsetDateTime::from_unix_timestamp(seconds)?.format(HTTP_DATE)?)
}

fn encode_uri_component(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || UNRESERVED.contains(&byte) {
            encoded.push(char::from(byte));
        } else {
            encoded.push('%');
            encoded.push(char::from(HEX_DIGITS[usize::from(byte >> 4)]));
            encoded.push(char::from(HEX_DIGITS[usize::from(byte & 0x0f)]));
        }
    }
    encoded
}

fn clear_tag(tag: &str) -> &str {
    let trimmed = tag.trim();
    let mut inner = trimmed.chars();
    match (inner.next(), inner.next_back()) {
        (Some(first), Some(last)) if is_quote(first) && is_quote(last) => inner.as_str(),
        _ => trimmed,
    }
}

fn is_quote(value: char) -> bool {
    value == '"' || value == '\''
}
