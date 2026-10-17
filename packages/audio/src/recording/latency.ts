import {
  type AudioInputSourceKind,
  type AudioOutputSourceKind,
  classifyAudioInputDevice,
  classifyAudioOutputDevice,
  getRealAudioInputDevices,
  resolveAudioOutputDevice,
  resolveDefaultAudioInputDevice,
} from './devices.js';

const inputLatencyPresetSecondsByKind: Record<AudioInputSourceKind, number> = {
  builtIn: 0.03,
  wiredHeadset: 0.025,
  bluetooth: 0.18,
  unknown: 0.04,
};

const outputLatencyFloorSecondsByKind: Record<AudioOutputSourceKind, number> = {
  builtIn: 0,
  wiredHeadset: 0,
  bluetooth: 0.18,
  unknown: 0,
};

export type RecordingInputSettings = {
  deviceId?: string;
  groupId?: string;
  latency?: number;
};

const resolveInputDevice = (
  settings: RecordingInputSettings,
  devices: MediaDeviceInfo[],
): MediaDeviceInfo | undefined => {
  const real = getRealAudioInputDevices(devices);
  if (settings.deviceId) {
    const direct = real.find((device) => device.deviceId === settings.deviceId);
    if (direct) {
      return direct;
    }
  }
  if (settings.groupId) {
    const byGroup = real.find((device) => device.groupId === settings.groupId);
    if (byGroup) {
      return byGroup;
    }
  }
  return resolveDefaultAudioInputDevice(devices);
};

const getDeviceKey = (device: MediaDeviceInfo) =>
  `${device.kind}:${device.label || device.deviceId}`;

export const getRecordingLatencyDevicePairKey = (
  inputDevice: MediaDeviceInfo | undefined,
  outputDevice: MediaDeviceInfo | undefined,
) => {
  const inputKey = inputDevice
    ? getDeviceKey(inputDevice)
    : 'audioinput:unknown';
  const outputKey = outputDevice
    ? getDeviceKey(outputDevice)
    : 'audiooutput:unknown';
  return `${inputKey}|${outputKey}`;
};

export type InputLatencyEstimateInput = {
  microphone: RecordingInputSettings;
  measuredInputLatency?: number;
  devices: MediaDeviceInfo[];
  outputDeviceId?: string;
};

export type InputLatencyEstimate = {
  inputKind: AudioInputSourceKind;
  inputLatencySeconds: number;
  outputKind: AudioOutputSourceKind;
  outputLatencyFloorSeconds: number;
  devicePairKey: string;
};

export const estimateInputLatency = (
  input: InputLatencyEstimateInput,
): InputLatencyEstimate => {
  const { devices, microphone } = input;
  const inputDevice = resolveInputDevice(microphone, devices);
  const outputDevice = resolveAudioOutputDevice(devices, {
    explicitDeviceId: input.outputDeviceId,
  });
  const inputKind: AudioInputSourceKind = inputDevice
    ? classifyAudioInputDevice(inputDevice)
    : 'unknown';
  const outputKind: AudioOutputSourceKind = outputDevice
    ? classifyAudioOutputDevice(outputDevice)
    : 'unknown';
  const chunkSeconds = microphone.latency ?? 0;
  const inputLatencySeconds =
    input.measuredInputLatency === undefined
      ? Math.max(chunkSeconds, inputLatencyPresetSecondsByKind[inputKind])
      : input.measuredInputLatency + chunkSeconds;

  return {
    inputKind,
    inputLatencySeconds,
    outputKind,
    outputLatencyFloorSeconds: outputLatencyFloorSecondsByKind[outputKind],
    devicePairKey: getRecordingLatencyDevicePairKey(inputDevice, outputDevice),
  };
};
