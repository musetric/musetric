import {
  type AudioInputSourceKind,
  type AudioOutputSourceKind,
  classifyAudioInputDevice,
  classifyAudioOutputDevice,
  getRealAudioInputDevices,
  resolveAudioOutputDevice,
  resolveDefaultAudioInputDevice,
} from './devices.js';

type AudioTrackSettingsWithLatency = MediaTrackSettings & {
  latency?: number;
};

type AudioContextWithOutputLatency = AudioContext & {
  outputLatency?: number;
};

const inputLatencyPresetSecondsByKind: Record<AudioInputSourceKind, number> = {
  builtIn: 0.03,
  wiredHeadset: 0.025,
  bluetooth: 0.18,
  unknown: 0.04,
};

const outputLatencyPresetSecondsByKind: Record<AudioOutputSourceKind, number> =
  {
    builtIn: 0.03,
    wiredHeadset: 0.025,
    bluetooth: 0.18,
    unknown: 0.04,
  };

export type RecordingLatencyEstimateInput = {
  context: AudioContext;
  stream: MediaStream;
  devices: MediaDeviceInfo[];
  outputDeviceId?: string;
};

export type RecordingLatencyEstimate = {
  latencySeconds: number;
  frameCount: number;
  inputKind: AudioInputSourceKind;
  inputLatencySeconds: number;
  inputLatencyFrameCount: number;
  outputKind: AudioOutputSourceKind;
  outputLatencySeconds: number;
  outputLatencyFrameCount: number;
  devicePairKey: string;
};

const resolveStreamInputDevice = (
  stream: MediaStream,
  devices: MediaDeviceInfo[],
): MediaDeviceInfo | undefined => {
  const [track] = stream.getAudioTracks();
  const settings = track.getSettings();
  const trackDeviceId = settings.deviceId;
  const real = getRealAudioInputDevices(devices);
  if (trackDeviceId) {
    const direct = real.find((device) => device.deviceId === trackDeviceId);
    if (direct) {
      return direct;
    }
  }
  const trackGroupId = settings.groupId;
  if (trackGroupId) {
    const byGroup = real.find((device) => device.groupId === trackGroupId);
    if (byGroup) {
      return byGroup;
    }
  }
  return resolveDefaultAudioInputDevice(devices);
};

const getTrackLatencySeconds = (stream: MediaStream) => {
  const [track] = stream.getAudioTracks();
  const settings: AudioTrackSettingsWithLatency = track.getSettings();
  return typeof settings.latency === 'number' ? settings.latency : 0;
};

const getContextOutputLatencySeconds = (context: AudioContext) => {
  const contextWithOutputLatency: AudioContextWithOutputLatency = context;
  const rawOutputLatency = contextWithOutputLatency.outputLatency;
  return typeof rawOutputLatency === 'number' ? rawOutputLatency : 0;
};

export const getRecordingLatencyDevicePairKey = (
  inputDevice: MediaDeviceInfo | undefined,
  outputDevice: MediaDeviceInfo | undefined,
) => {
  const inputKey = inputDevice
    ? `${inputDevice.kind}:${inputDevice.deviceId}`
    : 'audioinput:unknown';
  const outputKey = outputDevice
    ? `${outputDevice.kind}:${outputDevice.deviceId}`
    : 'audiooutput:unknown';
  return `${inputKey}|${outputKey}`;
};

export const estimateRecordingLatency = (
  input: RecordingLatencyEstimateInput,
): RecordingLatencyEstimate => {
  const { context, stream, devices } = input;
  const inputDevice = resolveStreamInputDevice(stream, devices);
  const outputDevice = resolveAudioOutputDevice(devices, {
    explicitDeviceId: input.outputDeviceId,
  });
  const inputKind: AudioInputSourceKind = inputDevice
    ? classifyAudioInputDevice(inputDevice)
    : 'unknown';
  const outputKind: AudioOutputSourceKind = outputDevice
    ? classifyAudioOutputDevice(outputDevice)
    : 'unknown';

  const inputLatencySeconds = Math.max(
    getTrackLatencySeconds(stream),
    inputLatencyPresetSecondsByKind[inputKind],
  );
  const outputLatencySeconds = Math.max(
    getContextOutputLatencySeconds(context),
    outputLatencyPresetSecondsByKind[outputKind],
  );
  const baseLatencySeconds = context.baseLatency || 0;

  const latencySeconds =
    baseLatencySeconds + inputLatencySeconds + outputLatencySeconds;
  return {
    latencySeconds,
    frameCount: Math.round(latencySeconds * context.sampleRate),
    inputKind,
    inputLatencySeconds,
    inputLatencyFrameCount: Math.round(
      inputLatencySeconds * context.sampleRate,
    ),
    outputKind,
    outputLatencySeconds,
    outputLatencyFrameCount: Math.round(
      outputLatencySeconds * context.sampleRate,
    ),
    devicePairKey: getRecordingLatencyDevicePairKey(inputDevice, outputDevice),
  };
};
