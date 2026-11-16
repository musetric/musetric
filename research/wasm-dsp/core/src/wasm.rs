use std::cell::RefCell;

thread_local! {
    static FLOATS: RefCell<Vec<f32>> = const { RefCell::new(Vec::new()) };
    static BYTES: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static ERROR: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static RATE: RefCell<u32> = const { RefCell::new(0) };
}

#[unsafe(no_mangle)]
pub extern "C" fn alloc(bytes: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(bytes);
    let pointer = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    pointer
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn release(pointer: *mut u8, bytes: usize) {
    unsafe { drop(Vec::from_raw_parts(pointer, 0, bytes)) };
}

#[unsafe(no_mangle)]
pub extern "C" fn floats_ptr() -> *const f32 {
    FLOATS.with_borrow(|floats| floats.as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn floats_len() -> usize {
    FLOATS.with_borrow(Vec::len)
}

#[unsafe(no_mangle)]
pub extern "C" fn bytes_ptr() -> *const u8 {
    BYTES.with_borrow(|bytes| bytes.as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn bytes_len() -> usize {
    BYTES.with_borrow(Vec::len)
}

#[unsafe(no_mangle)]
pub extern "C" fn error_ptr() -> *const u8 {
    ERROR.with_borrow(|error| error.as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn error_len() -> usize {
    ERROR.with_borrow(Vec::len)
}

#[unsafe(no_mangle)]
pub extern "C" fn source_rate() -> u32 {
    RATE.with_borrow(|rate| *rate)
}

#[unsafe(no_mangle)]
pub extern "C" fn clear() {
    FLOATS.with_borrow_mut(|floats| *floats = Vec::new());
    BYTES.with_borrow_mut(|bytes| *bytes = Vec::new());
}

fn fail(failure: &crate::BoxedError) -> i32 {
    ERROR.with_borrow_mut(|error| *error = failure.to_string().into_bytes());
    -1
}

#[cfg(any(feature = "decode", feature = "resample", feature = "stretch"))]
fn keep_floats(result: Result<Vec<f32>, crate::BoxedError>) -> i32 {
    match result {
        Ok(floats) => {
            let length = floats.len();
            FLOATS.with_borrow_mut(|kept| *kept = floats);
            i32::try_from(length).unwrap_or(i32::MAX)
        }
        Err(failure) => fail(&failure),
    }
}

#[cfg(feature = "encode")]
fn keep_bytes(result: Result<Vec<u8>, crate::BoxedError>) -> i32 {
    match result {
        Ok(bytes) => {
            let length = bytes.len();
            BYTES.with_borrow_mut(|kept| *kept = bytes);
            i32::try_from(length).unwrap_or(i32::MAX)
        }
        Err(failure) => fail(&failure),
    }
}

unsafe fn floats<'input>(pointer: *const f32, length: usize) -> &'input [f32] {
    unsafe { std::slice::from_raw_parts(pointer, length) }
}

#[cfg(feature = "decode")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn decode(
    pointer: *mut u8,
    length: usize,
    extension: *const u8,
    extension_length: usize,
    sample_rate: u32,
) -> i32 {
    let bytes = unsafe { Vec::from_raw_parts(pointer, length, length) };
    let extension = unsafe { std::slice::from_raw_parts(extension, extension_length) };
    let extension = std::str::from_utf8(extension).unwrap_or("");
    match crate::decode(bytes, extension, sample_rate) {
        Ok((floats, rate)) => {
            RATE.with_borrow_mut(|kept| *kept = rate);
            keep_floats(Ok(floats))
        }
        Err(failure) => fail(&failure),
    }
}

#[cfg(feature = "decode")]
thread_local! {
    static FILE: RefCell<&'static [u8]> = const { RefCell::new(&[]) };
}

#[cfg(feature = "decode")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn keep_file(pointer: *mut u8, length: usize) {
    let bytes: &'static [u8] = unsafe { std::slice::from_raw_parts(pointer, length) };
    FILE.with_borrow_mut(|file| *file = bytes);
}

#[cfg(feature = "decode")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn decode_window(
    extension: *const u8,
    extension_length: usize,
    start_ms: u32,
    length_ms: u32,
) -> i32 {
    let extension = unsafe { std::slice::from_raw_parts(extension, extension_length) };
    let extension = std::str::from_utf8(extension).unwrap_or("");
    let bytes = FILE.with_borrow(|file| *file);
    keep_floats(crate::decode_window(
        bytes,
        extension,
        i64::from(start_ms),
        i64::from(length_ms),
    ))
}

#[cfg(feature = "resample")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn resample(
    pointer: *const f32,
    length: usize,
    input: u32,
    output: u32,
) -> i32 {
    keep_floats(crate::resample(
        unsafe { floats(pointer, length) },
        input,
        output,
    ))
}

#[cfg(feature = "encode")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn encode(
    pointer: *const f32,
    length: usize,
    format: u32,
    sample_rate: u32,
    bitrate: u32,
) -> i32 {
    let samples = unsafe { floats(pointer, length) };
    keep_bytes(match format {
        0 => crate::encode_flac(samples, sample_rate),
        1 => crate::encode_aac(samples, sample_rate, bitrate),
        _ => crate::encode_mp3(samples, sample_rate, bitrate),
    })
}

#[cfg(feature = "stretch")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn stretch(
    pointer: *const f32,
    length: usize,
    sample_rate: u32,
    semitones: i32,
    tempo_percent: u32,
    keep_formants: u32,
) -> i32 {
    keep_floats(crate::stretch(
        unsafe { floats(pointer, length) },
        sample_rate,
        semitones,
        tempo_percent as usize,
        keep_formants != 0,
    ))
}
