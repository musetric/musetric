#![expect(
    unsafe_code,
    reason = "CoreAudio and AVFAudio reach the microphone only through their C and Objective-C interfaces"
)]

use std::{
    ffi::c_void,
    fmt,
    mem::{MaybeUninit, offset_of, size_of},
    ptr::{self, NonNull},
    slice,
};

use block2::RcBlock;
use objc2::runtime::Bool;
use objc2_avf_audio::{AVAudioApplication, AVAudioApplicationRecordPermission};
use objc2_core_audio::{
    AudioConvertHostTimeToNanos, AudioDeviceCreateIOProcID, AudioDeviceDestroyIOProcID,
    AudioDeviceIOProcID, AudioDeviceStart, AudioDeviceStop, AudioGetCurrentHostTime,
    AudioObjectAddPropertyListener, AudioObjectGetPropertyData, AudioObjectGetPropertyDataSize,
    AudioObjectID, AudioObjectPropertyAddress, AudioObjectPropertyListenerProc,
    AudioObjectPropertyScope, AudioObjectPropertySelector, AudioObjectRemovePropertyListener,
    kAudioDevicePropertyDeviceUID, kAudioDevicePropertyLatency,
    kAudioDevicePropertyStreamConfiguration, kAudioDevicePropertyStreams,
    kAudioDevicePropertyTransportType, kAudioHardwarePropertyDevices,
    kAudioHardwarePropertyTranslateUIDToDevice, kAudioObjectPropertyElementMain,
    kAudioObjectPropertyName, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyScopeInput,
    kAudioObjectPropertyScopeOutput, kAudioObjectSystemObject, kAudioObjectUnknown,
    kAudioStreamPropertyLatency, kAudioStreamPropertyVirtualFormat,
};
use objc2_core_audio_types::{
    AudioBuffer, AudioBufferList, AudioStreamBasicDescription, AudioTimeStamp,
    kAudioFormatFlagIsFloat, kAudioFormatLinearPCM,
};
use objc2_core_foundation::{CFRetained, CFString};

const NO_ERROR: i32 = 0;
const FLOAT_BITS: u32 = 32;
const NANOS_PER_MS: f64 = 1_000_000.0;
const SYSTEM: AudioObjectID = kAudioObjectSystemObject.cast_unsigned();
const WRONG_SIZE: &str = "CoreAudio answered with a value of another size";
const NO_STRING: &str = "CoreAudio answered with no string";
const NO_INPUT: &str = "the device has no input";
const NOT_FLOAT: &str = "the microphone does not deliver 32-bit float samples";

pub(crate) type Device = AudioObjectID;

pub(crate) enum AudioError {
    Status(i32),
    Unexpected(&'static str),
}

impl fmt::Display for AudioError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Status(status) => {
                let code = status.to_be_bytes();
                if code.iter().all(u8::is_ascii_graphic) {
                    write!(
                        formatter,
                        "CoreAudio error '{}'",
                        String::from_utf8_lossy(&code)
                    )
                } else {
                    write!(formatter, "CoreAudio error {status}")
                }
            }
            Self::Unexpected(text) => formatter.write_str(text),
        }
    }
}

fn check(status: i32) -> Result<(), AudioError> {
    if status == NO_ERROR {
        Ok(())
    } else {
        Err(AudioError::Status(status))
    }
}

#[derive(Clone, Copy)]
pub(crate) enum Scope {
    Global,
    Input,
    Output,
}

impl Scope {
    fn raw(self) -> AudioObjectPropertyScope {
        match self {
            Self::Global => kAudioObjectPropertyScopeGlobal,
            Self::Input => kAudioObjectPropertyScopeInput,
            Self::Output => kAudioObjectPropertyScopeOutput,
        }
    }
}

fn address(selector: AudioObjectPropertySelector, scope: Scope) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress {
        mSelector: selector,
        mScope: scope.raw(),
        mElement: kAudioObjectPropertyElementMain,
    }
}

fn byte_size<T>(count: usize) -> u32 {
    u32::try_from(count * size_of::<T>()).unwrap_or(u32::MAX)
}

trait Plain: Copy {}

impl Plain for u32 {}

impl Plain for u64 {}

impl Plain for AudioStreamBasicDescription {}

impl Plain for *const CFString {}

fn read<T: Plain>(
    object: AudioObjectID,
    address: AudioObjectPropertyAddress,
    qualifier: Option<&*const CFString>,
) -> Result<T, AudioError> {
    let mut value = MaybeUninit::<T>::uninit();
    let expected = byte_size::<T>(1);
    let mut size = expected;
    let (qualifier_size, qualifier_data) = qualifier.map_or((0, ptr::null()), |reference| {
        (
            byte_size::<*const CFString>(1),
            ptr::from_ref(reference).cast(),
        )
    });
    check(unsafe {
        AudioObjectGetPropertyData(
            object,
            NonNull::from(&address),
            qualifier_size,
            qualifier_data,
            NonNull::from(&mut size),
            NonNull::from(&mut value).cast(),
        )
    })?;
    if size != expected {
        return Err(AudioError::Unexpected(WRONG_SIZE));
    }
    Ok(unsafe { value.assume_init() })
}

fn read_size(
    object: AudioObjectID,
    address: AudioObjectPropertyAddress,
) -> Result<usize, AudioError> {
    let mut size = 0;
    check(unsafe {
        AudioObjectGetPropertyDataSize(
            object,
            NonNull::from(&address),
            0,
            ptr::null(),
            NonNull::from(&mut size),
        )
    })?;
    Ok(size as usize)
}

fn read_into<T: Plain>(
    object: AudioObjectID,
    address: AudioObjectPropertyAddress,
    data: &mut [T],
) -> Result<usize, AudioError> {
    if data.is_empty() {
        return Ok(0);
    }
    let mut size = byte_size::<T>(data.len());
    check(unsafe {
        AudioObjectGetPropertyData(
            object,
            NonNull::from(&address),
            0,
            ptr::null(),
            NonNull::from(&mut size),
            NonNull::from(data).cast(),
        )
    })?;
    Ok(size as usize)
}

fn read_objects(
    object: AudioObjectID,
    selector: AudioObjectPropertySelector,
    scope: Scope,
) -> Result<Vec<AudioObjectID>, AudioError> {
    let property = address(selector, scope);
    let count = read_size(object, property)? / size_of::<AudioObjectID>();
    let mut objects = vec![kAudioObjectUnknown; count];
    let read = read_into(object, property, &mut objects)?;
    objects.truncate(read / size_of::<AudioObjectID>());
    Ok(objects)
}

fn read_string(
    object: AudioObjectID,
    selector: AudioObjectPropertySelector,
) -> Result<String, AudioError> {
    let reference: *const CFString = read(object, address(selector, Scope::Global), None)?;
    let string = NonNull::new(reference.cast_mut())
        .map(|string| unsafe { CFRetained::from_raw(string) })
        .ok_or(AudioError::Unexpected(NO_STRING))?;
    Ok(string.to_string())
}

pub(crate) fn system_devices() -> Result<Vec<Device>, AudioError> {
    read_objects(SYSTEM, kAudioHardwarePropertyDevices, Scope::Global)
}

pub(crate) fn system_device(selector: AudioObjectPropertySelector) -> Result<Device, AudioError> {
    read(SYSTEM, address(selector, Scope::Global), None)
}

pub(crate) fn device_of_uid(device_uid: &str) -> Result<Device, AudioError> {
    let string = CFString::from_str(device_uid);
    let reference: *const CFString = &raw const *string;
    read(
        SYSTEM,
        address(kAudioHardwarePropertyTranslateUIDToDevice, Scope::Global),
        Some(&reference),
    )
}

pub(crate) fn uid(device: Device) -> Result<String, AudioError> {
    read_string(device, kAudioDevicePropertyDeviceUID)
}

pub(crate) fn name(device: Device) -> Result<String, AudioError> {
    read_string(device, kAudioObjectPropertyName)
}

pub(crate) fn transport(device: Device) -> Result<u32, AudioError> {
    read(
        device,
        address(kAudioDevicePropertyTransportType, Scope::Global),
        None,
    )
}

pub(crate) fn channels(device: Device, scope: Scope) -> Result<u32, AudioError> {
    let property = address(kAudioDevicePropertyStreamConfiguration, scope);
    let size = read_size(device, property)?;
    let mut storage = vec![0_u64; size.div_ceil(size_of::<u64>())];
    let header = offset_of!(AudioBufferList, mBuffers);
    let read = read_into(device, property, &mut storage)?;
    if read < header {
        return Ok(0);
    }
    let list = storage.as_ptr().cast::<AudioBufferList>();
    let count = (unsafe { (*list).mNumberBuffers } as usize)
        .min((read - header) / size_of::<AudioBuffer>());
    let buffers = unsafe {
        slice::from_raw_parts((&raw const (*list).mBuffers).cast::<AudioBuffer>(), count)
    };
    Ok(buffers.iter().map(|buffer| buffer.mNumberChannels).sum())
}

pub(crate) struct InputFormat {
    pub(crate) sample_rate: f64,
    pub(crate) latency_frames: u32,
}

pub(crate) fn input_format(device: Device) -> Result<InputFormat, AudioError> {
    let streams = read_objects(device, kAudioDevicePropertyStreams, Scope::Input)?;
    let stream = *streams.first().ok_or(AudioError::Unexpected(NO_INPUT))?;
    let format: AudioStreamBasicDescription = read(
        stream,
        address(kAudioStreamPropertyVirtualFormat, Scope::Global),
        None,
    )?;
    if format.mFormatID != kAudioFormatLinearPCM
        || format.mFormatFlags & kAudioFormatFlagIsFloat == 0
        || format.mBitsPerChannel != FLOAT_BITS
    {
        return Err(AudioError::Unexpected(NOT_FLOAT));
    }
    let device_latency: u32 = read(
        device,
        address(kAudioDevicePropertyLatency, Scope::Input),
        None,
    )?;
    let stream_latency: u32 = read(
        stream,
        address(kAudioStreamPropertyLatency, Scope::Global),
        None,
    )?;
    Ok(InputFormat {
        sample_rate: format.mSampleRate,
        latency_frames: device_latency + stream_latency,
    })
}

#[expect(
    clippy::cast_precision_loss,
    reason = "host time in nanoseconds stays below 2^53 for over a hundred days of uptime"
)]
pub(crate) fn host_time_ms(host_time: u64) -> f64 {
    (unsafe { AudioConvertHostTimeToNanos(host_time) }) as f64 / NANOS_PER_MS
}

pub(crate) fn current_host_time() -> u64 {
    unsafe { AudioGetCurrentHostTime() }
}

pub(crate) struct Input<'data> {
    pub(crate) time: &'data AudioTimeStamp,
    pub(crate) samples: &'data [f32],
    pub(crate) channels: usize,
}

unsafe extern "C-unwind" fn receive<H: Fn(&Input<'_>) + Sync>(
    _: AudioObjectID,
    _: NonNull<AudioTimeStamp>,
    input: NonNull<AudioBufferList>,
    time: NonNull<AudioTimeStamp>,
    _: NonNull<AudioBufferList>,
    _: NonNull<AudioTimeStamp>,
    data: *mut c_void,
) -> i32 {
    let handler = unsafe { &*data.cast_const().cast::<H>() };
    let list = unsafe { input.as_ref() };
    let [buffer] = &list.mBuffers;
    if list.mNumberBuffers == 0 || buffer.mData.is_null() || buffer.mNumberChannels == 0 {
        return NO_ERROR;
    }
    let samples = unsafe {
        slice::from_raw_parts(
            buffer.mData.cast_const().cast::<f32>(),
            buffer.mDataByteSize as usize / size_of::<f32>(),
        )
    };
    handler(&Input {
        time: unsafe { time.as_ref() },
        samples,
        channels: buffer.mNumberChannels as usize,
    });
    NO_ERROR
}

pub(crate) struct InputProc<H> {
    device: Device,
    id: AudioDeviceIOProcID,
    _handler: Box<H>,
}

impl<H: Fn(&Input<'_>) + Send + Sync> InputProc<H> {
    pub(crate) fn start(device: Device, handler: H) -> Result<Self, AudioError> {
        let boxed = Box::new(handler);
        let mut id: AudioDeviceIOProcID = None;
        check(unsafe {
            AudioDeviceCreateIOProcID(
                device,
                Some(receive::<H>),
                ptr::from_ref::<H>(&boxed).cast_mut().cast(),
                NonNull::from(&mut id),
            )
        })?;
        let input = Self {
            device,
            id,
            _handler: boxed,
        };
        check(unsafe { AudioDeviceStart(input.device, input.id) })?;
        Ok(input)
    }
}

impl<H> Drop for InputProc<H> {
    fn drop(&mut self) {
        if let Err(error) = check(unsafe { AudioDeviceStop(self.device, self.id) }) {
            log::error!("could not stop the microphone: {error}");
        }
        if let Err(error) = check(unsafe { AudioDeviceDestroyIOProcID(self.device, self.id) }) {
            log::error!("could not release the microphone: {error}");
        }
    }
}

unsafe extern "C-unwind" fn changed<H: Fn() + Sync>(
    _: AudioObjectID,
    _: u32,
    _: NonNull<AudioObjectPropertyAddress>,
    data: *mut c_void,
) -> i32 {
    let handler = unsafe { &*data.cast_const().cast::<H>() };
    handler();
    NO_ERROR
}

pub(crate) struct SystemListener<H> {
    addresses: Vec<AudioObjectPropertyAddress>,
    listener: AudioObjectPropertyListenerProc,
    handler: Box<H>,
}

impl<H: Fn() + Send + Sync> SystemListener<H> {
    pub(crate) fn listen(
        selectors: &[AudioObjectPropertySelector],
        handler: H,
    ) -> Result<Self, AudioError> {
        let mut listener = Self {
            addresses: Vec::with_capacity(selectors.len()),
            listener: Some(changed::<H>),
            handler: Box::new(handler),
        };
        for selector in selectors {
            let property = address(*selector, Scope::Global);
            check(unsafe {
                AudioObjectAddPropertyListener(
                    SYSTEM,
                    NonNull::from(&property),
                    listener.listener,
                    listener.data(),
                )
            })?;
            listener.addresses.push(property);
        }
        Ok(listener)
    }
}

impl<H> SystemListener<H> {
    fn data(&self) -> *mut c_void {
        ptr::from_ref::<H>(&self.handler).cast_mut().cast()
    }
}

impl<H> Drop for SystemListener<H> {
    fn drop(&mut self) {
        for property in &self.addresses {
            let removed = check(unsafe {
                AudioObjectRemovePropertyListener(
                    SYSTEM,
                    NonNull::from(property),
                    self.listener,
                    self.data(),
                )
            });
            if let Err(error) = removed {
                log::error!("could not stop watching the audio devices: {error}");
            }
        }
    }
}

pub(crate) enum Permission {
    Granted,
    Denied,
    Undetermined,
}

pub(crate) fn record_permission() -> Permission {
    let permission = unsafe { AVAudioApplication::sharedInstance().recordPermission() };
    if permission == AVAudioApplicationRecordPermission::Granted {
        Permission::Granted
    } else if permission == AVAudioApplicationRecordPermission::Denied {
        Permission::Denied
    } else {
        Permission::Undetermined
    }
}

pub(crate) fn request_record_permission(answer: impl Fn(bool) + 'static) {
    let block = RcBlock::new(move |granted: Bool| answer(granted.as_bool()));
    unsafe { AVAudioApplication::requestRecordPermissionWithCompletionHandler(&block) };
}
