use axum::http::{HeaderMap, header::RANGE};

const UNIT: &str = "bytes";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ByteRange {
    Full,
    Partial(PartialRange),
    Unsatisfiable,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct PartialRange {
    pub(crate) start: u64,
    pub(crate) end: u64,
}

pub(crate) fn parse(headers: &HeaderMap, size: u64) -> ByteRange {
    let value = headers
        .get(RANGE)
        .and_then(|found| found.to_str().ok())
        .unwrap_or_default();
    match parse_value(value, size) {
        Some(found) => found,
        None => ByteRange::Full,
    }
}

fn parse_value(value: &str, size: u64) -> Option<ByteRange> {
    let (unit, specification) = value.split_once('=')?;
    if unit.trim() != UNIT || specification.contains(',') {
        return Some(ByteRange::Full);
    }
    let (raw_start, raw_end) = specification.split_once('-')?;
    let start = raw_start.trim();
    let end = raw_end.trim();
    let parsed = match (start.parse::<u64>(), end.parse::<u64>()) {
        (Ok(first), Ok(last)) if first <= last => bounded(first, last, size),
        (Ok(first), Err(_)) if end.is_empty() => bounded(first, size.saturating_sub(1), size),
        (Err(_), Ok(suffix)) if start.is_empty() && suffix > 0 => {
            bounded(size.saturating_sub(suffix), size.saturating_sub(1), size)
        }
        (Err(_), Ok(0)) if start.is_empty() => ByteRange::Unsatisfiable,
        _ => return None,
    };
    Some(parsed)
}

fn bounded(start: u64, end: u64, size: u64) -> ByteRange {
    if size == 0 || start >= size {
        return ByteRange::Unsatisfiable;
    }
    ByteRange::Partial(PartialRange {
        start,
        end: end.min(size - 1),
    })
}

#[cfg(test)]
mod tests {
    use axum::http::{HeaderMap, header::RANGE};

    use super::{ByteRange, parse};

    const SIZE: u64 = 13;

    fn parsed(value: &str) -> ByteRange {
        let mut headers = HeaderMap::new();
        if !value.is_empty() {
            headers.insert(RANGE, value.parse().expect("the header should be valid"));
        }
        parse(&headers, SIZE)
    }

    fn bytes(found: ByteRange) -> (u64, u64) {
        let ByteRange::Partial(range) = found else {
            panic!("the range should be partial");
        };
        (range.start, range.end)
    }

    #[test]
    fn answers_the_whole_body_without_a_range_header() {
        assert_eq!(parsed(""), ByteRange::Full);
    }

    #[test]
    fn answers_the_whole_body_for_another_unit() {
        assert_eq!(parsed("pages=0-1"), ByteRange::Full);
    }

    #[test]
    fn answers_the_whole_body_for_several_ranges() {
        assert_eq!(parsed("bytes=0-1,3-4"), ByteRange::Full);
    }

    #[test]
    fn answers_the_whole_body_for_a_broken_specification() {
        assert_eq!(parsed("bytes=x-y"), ByteRange::Full);
        assert_eq!(parsed("bytes=-"), ByteRange::Full);
        assert_eq!(parsed("bytes=5-x"), ByteRange::Full);
        assert_eq!(parsed("bytes=x-5"), ByteRange::Full);
        assert_eq!(parsed("bytes=9-4"), ByteRange::Full);
    }

    #[test]
    fn cuts_a_bounded_range_at_the_end_of_the_body() {
        assert_eq!(bytes(parsed("bytes=2-5")), (2, 5));
        assert_eq!(bytes(parsed("bytes=2-40")), (2, 12));
        assert_eq!(bytes(parsed("bytes=12-12")), (12, 12));
    }

    #[test]
    fn keeps_an_open_range_to_the_end_of_the_body() {
        assert_eq!(bytes(parsed("bytes=10-")), (10, 12));
        assert_eq!(bytes(parsed("bytes=0-")), (0, 12));
    }

    #[test]
    fn reads_a_suffix_range_from_the_end_of_the_body() {
        assert_eq!(bytes(parsed("bytes=-4")), (9, 12));
        assert_eq!(bytes(parsed("bytes=-40")), (0, 12));
    }

    #[test]
    fn refuses_ranges_that_start_after_the_body() {
        assert_eq!(parsed("bytes=13-"), ByteRange::Unsatisfiable);
        assert_eq!(parsed("bytes=40-50"), ByteRange::Unsatisfiable);
        assert_eq!(parsed("bytes=-0"), ByteRange::Unsatisfiable);
    }

    #[test]
    fn refuses_every_range_for_an_empty_body_stream() {
        let mut headers = HeaderMap::new();
        headers.insert(
            RANGE,
            "bytes=0-".parse().expect("the header should be valid"),
        );

        assert_eq!(parse(&headers, 0), ByteRange::Unsatisfiable);
    }
}
