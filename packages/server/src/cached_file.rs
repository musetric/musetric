use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    body::Body,
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{
            CACHE_CONTROL, CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_TYPE, ETAG, IF_NONE_MATCH,
            LAST_MODIFIED,
        },
    },
    response::Response,
};
use musetric_db::BoxedError;
use time::{OffsetDateTime, format_description::BorrowedFormatItem, macros::format_description};

const CACHE_CONTROL_VALUE: &str = "public, max-age=86400";
const UNRESERVED: &[u8] = b"-_.!~*'()";
const HEX_DIGITS: &[u8; 16] = b"0123456789ABCDEF";
const HTTP_DATE: &[BorrowedFormatItem<'_>] = format_description!(
    "[weekday repr:short], [day] [month repr:short] [year] [hour]:[minute]:[second] GMT"
);

pub(crate) struct CachedFile {
    pub(crate) filename: String,
    pub(crate) content_type: &'static str,
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
        let disposition = format!(
            "attachment; filename*=UTF-8''{}",
            encode_uri_component(&file.filename)
        );
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_str(file.content_type)?);
        headers.insert(CONTENT_DISPOSITION, HeaderValue::from_str(&disposition)?);
        headers.insert(
            LAST_MODIFIED,
            HeaderValue::from_str(&format_http_date(file.modified)?)?,
        );
        headers.insert(CACHE_CONTROL, HeaderValue::from_static(CACHE_CONTROL_VALUE));
        headers.insert(ETAG, HeaderValue::from_str(&etag)?);
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

#[cfg(test)]
mod tests {
    use std::time::{Duration, UNIX_EPOCH};

    use axum::http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{CONTENT_DISPOSITION, CONTENT_LENGTH, IF_NONE_MATCH},
    };

    use super::{CachedFile, CachedHeaders, create_etag, encode_uri_component, format_http_date};

    const FIXTURE_MODIFIED: Duration = Duration::new(1_577_836_800, 0);
    const SUB_MILLISECOND: Duration = Duration::new(1_577_836_800, 123_456_800);

    fn create_file(size: u64, modified: Duration) -> CachedFile {
        CachedFile {
            filename: "Fixture project_chords.json".to_owned(),
            content_type: "application/json",
            size,
            modified: UNIX_EPOCH + modified,
        }
    }

    fn create_request(if_none_match: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            IF_NONE_MATCH,
            HeaderValue::from_str(if_none_match).expect("the header should be valid"),
        );
        headers
    }

    #[test]
    fn hashes_the_size_and_the_modification_time_the_way_node_does() {
        let file = create_file(75, FIXTURE_MODIFIED);

        let etag = create_etag(&file).expect("the etag should be built");

        assert_eq!(etag, "3fe28810f1fb20270d39f00c2446d507");
    }

    #[test]
    fn keeps_the_fractional_milliseconds_node_reports() {
        let file = create_file(12345, SUB_MILLISECOND);

        let etag = create_etag(&file).expect("the etag should be built");

        assert_eq!(etag, "e1b307806ea3b9b789d2fb03fd1545f5");
    }

    #[test]
    fn writes_the_modification_time_as_an_http_date() {
        let modified = UNIX_EPOCH + SUB_MILLISECOND;

        let formatted = format_http_date(modified).expect("the date should be formatted");

        assert_eq!(formatted, "Wed, 01 Jan 2020 00:00:00 GMT");
    }

    #[test]
    fn escapes_a_filename_the_way_encode_uri_component_does() {
        let encoded = encode_uri_component("песня (live) #1 & 'дубль'.json");

        assert_eq!(
            encoded,
            "%D0%BF%D0%B5%D1%81%D0%BD%D1%8F%20(live)%20%231%20%26%20'%D0%B4%D1%83%D0%B1%D0%BB%D1%8C'.json"
        );
    }

    #[test]
    fn answers_not_modified_for_a_quoted_tag_in_a_list() {
        let file = create_file(75, FIXTURE_MODIFIED);
        let headers = CachedHeaders::create(&file).expect("the headers should be built");

        let matched = headers.is_not_modified(&create_request(
            "\"other\", \"3fe28810f1fb20270d39f00c2446d507\"",
        ));
        let missed = headers.is_not_modified(&create_request("\"other\""));

        assert!(matched);
        assert!(!missed);
    }

    #[test]
    fn drops_the_content_length_when_the_answer_has_no_body() {
        let file = create_file(75, FIXTURE_MODIFIED);
        let headers = CachedHeaders::create(&file).expect("the headers should be built");

        let response = headers.respond_not_modified();

        assert_eq!(response.status(), StatusCode::NOT_MODIFIED);
        assert!(!response.headers().contains_key(CONTENT_LENGTH));
        assert_eq!(
            response
                .headers()
                .get(CONTENT_DISPOSITION)
                .and_then(|value| value.to_str().ok()),
            Some("attachment; filename*=UTF-8''Fixture%20project_chords.json")
        );
    }
}
