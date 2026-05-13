export type CreateMicrophoneAudioConstraintsOptions = {
  deviceId?: string;
  sampleRate: number;
};

type AudioTrackSettingsWithLatency = MediaTrackSettings & {
  latency?: number;
};

const bluetoothLatencyPresetSeconds = 0.22;

export const createMicrophoneAudioConstraints = (
  options: CreateMicrophoneAudioConstraintsOptions,
): MediaTrackConstraints => {
  const constraints: MediaTrackConstraints = {
    channelCount: { ideal: 1 },
    echoCancellation: { ideal: false },
    noiseSuppression: { ideal: false },
    autoGainControl: { ideal: false },
    sampleRate: { ideal: options.sampleRate },
  };

  if (options.deviceId) {
    constraints.deviceId = {
      exact: options.deviceId,
    };
  }

  return constraints;
};

export const getMicrophoneLatencyFrameCount = (
  context: AudioContext,
  stream: MediaStream,
) => {
  const [track] = stream.getAudioTracks();
  const settings: AudioTrackSettingsWithLatency = track.getSettings();
  const inputLatency =
    typeof settings.latency === 'number' ? settings.latency : 0;
  const outputLatency =
    'outputLatency' in context && typeof context.outputLatency === 'number'
      ? context.outputLatency
      : 0;
  const latencySeconds = context.baseLatency + outputLatency + inputLatency;
  return Math.round(latencySeconds * context.sampleRate);
};

export const getBluetoothLatencyPresetFrameCount = (sampleRate: number) =>
  Math.round(bluetoothLatencyPresetSeconds * sampleRate);

export const isLikelyBluetoothAudioDevice = (device: MediaDeviceInfo) => {
  const label = device.label.toLowerCase();
  return (
    label.includes('bluetooth') ||
    label.includes('airpods') ||
    label.includes('buds') ||
    label.includes('wireless') ||
    label.includes('a2dp') ||
    label.includes('hands-free') ||
    label.includes('handsfree')
  );
};

export const hasLikelyBluetoothAudioDevice = (devices: MediaDeviceInfo[]) =>
  devices.some((device) => isLikelyBluetoothAudioDevice(device));

export const hasLikelyBluetoothDefaultAudioOutput = (
  devices: MediaDeviceInfo[],
) =>
  devices.some(
    (device) =>
      device.kind === 'audiooutput' &&
      device.deviceId === 'default' &&
      isLikelyBluetoothAudioDevice(device),
  );

export const getInitialMicrophoneLatencyFrameCount = (
  context: AudioContext,
  stream: MediaStream,
  devices: MediaDeviceInfo[],
) =>
  getMicrophoneLatencyFrameCount(context, stream) +
  (hasLikelyBluetoothDefaultAudioOutput(devices)
    ? getBluetoothLatencyPresetFrameCount(context.sampleRate)
    : 0);
