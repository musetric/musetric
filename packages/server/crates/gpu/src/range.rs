use axum::http::{HeaderMap, header::RANGE};

const UNIT: &str = "bytes";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ByteRange {
    Full,
    Partial(PartialRange),
    Unsatisfiable,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PartialRange {
    pub start: u64,
    pub end: u64,
}

#[must_use]
pub fn parse(headers: &HeaderMap, size: u64) -> ByteRange {
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
