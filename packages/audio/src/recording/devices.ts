export const isPseudoDefaultDeviceId = (deviceId: string) =>
  deviceId === 'default' || deviceId === 'communications';

export const mobileUserAgentPattern = /Android|iPhone|iPad|iPod|Mobile/i;

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

export const isLikelyWiredHeadsetAudioDevice = (device: MediaDeviceInfo) => {
  const label = device.label.toLowerCase();
  if (isLikelyBluetoothAudioDevice(device)) {
    return false;
  }
  return (
    label.includes('headset earpiece') ||
    label.includes('wired headset') ||
    label.includes('wired headphone') ||
    label.includes('earphone') ||
    label.includes('headphone')
  );
};

export const isLikelyBuiltInMicrophoneDevice = (device: MediaDeviceInfo) => {
  const label = device.label.toLowerCase();
  if (
    isLikelyBluetoothAudioDevice(device) ||
    isLikelyWiredHeadsetAudioDevice(device)
  ) {
    return false;
  }
  return (
    label.includes('speakerphone') ||
    label.includes('built-in') ||
    label.includes('built in') ||
    label.includes('internal') ||
    label === 'microphone' ||
    label.startsWith('microphone ') ||
    label.startsWith('microphone(')
  );
};

export const isLikelyBuiltInAudioOutputDevice = (device: MediaDeviceInfo) => {
  const label = device.label.toLowerCase();
  if (
    isLikelyBluetoothAudioDevice(device) ||
    isLikelyWiredHeadsetAudioDevice(device)
  ) {
    return false;
  }
  return (
    label.includes('speakerphone') ||
    label.includes('speaker') ||
    label.includes('built-in') ||
    label.includes('built in') ||
    label.includes('internal')
  );
};

export type AudioInputSourceKind =
  | 'builtIn'
  | 'wiredHeadset'
  | 'bluetooth'
  | 'unknown';

export const classifyAudioInputDevice = (
  device: MediaDeviceInfo,
): AudioInputSourceKind => {
  if (isLikelyBluetoothAudioDevice(device)) return 'bluetooth';
  if (isLikelyWiredHeadsetAudioDevice(device)) return 'wiredHeadset';
  if (isLikelyBuiltInMicrophoneDevice(device)) return 'builtIn';
  return 'unknown';
};

export type AudioOutputSourceKind =
  | 'builtIn'
  | 'wiredHeadset'
  | 'bluetooth'
  | 'unknown';

export const classifyAudioOutputDevice = (
  device: MediaDeviceInfo,
): AudioOutputSourceKind => {
  if (isLikelyBluetoothAudioDevice(device)) return 'bluetooth';
  if (isLikelyWiredHeadsetAudioDevice(device)) return 'wiredHeadset';
  if (isLikelyBuiltInAudioOutputDevice(device)) return 'builtIn';
  return 'unknown';
};

export const getAudioInputDevices = (devices: MediaDeviceInfo[]) =>
  devices.filter((device) => device.kind === 'audioinput');

export const getAudioOutputDevices = (devices: MediaDeviceInfo[]) =>
  devices.filter((device) => device.kind === 'audiooutput');

export const getRealAudioInputDevices = (devices: MediaDeviceInfo[]) =>
  getAudioInputDevices(devices).filter(
    (device) => !isPseudoDefaultDeviceId(device.deviceId),
  );

export const getRealAudioOutputDevices = (devices: MediaDeviceInfo[]) =>
  getAudioOutputDevices(devices).filter(
    (device) => !isPseudoDefaultDeviceId(device.deviceId),
  );

const resolveDefaultDevice = (
  pseudoDevices: MediaDeviceInfo[],
  realDevices: MediaDeviceInfo[],
) => {
  const defaultDevice = pseudoDevices.find(
    (device) => device.deviceId === 'default',
  );
  const candidates =
    defaultDevice === undefined ? pseudoDevices : [defaultDevice];

  for (const pseudoDevice of candidates) {
    if (pseudoDevice.groupId) {
      const match = realDevices.find(
        (device) => device.groupId === pseudoDevice.groupId,
      );
      if (match) return match;
    }
  }

  return undefined;
};

export const resolveDefaultAudioInputDevice = (
  devices: MediaDeviceInfo[],
): MediaDeviceInfo | undefined => {
  const pseudoDevices = getAudioInputDevices(devices).filter((device) =>
    isPseudoDefaultDeviceId(device.deviceId),
  );
  return resolveDefaultDevice(pseudoDevices, getRealAudioInputDevices(devices));
};

export const resolveDefaultAudioOutputDevice = (
  devices: MediaDeviceInfo[],
): MediaDeviceInfo | undefined => {
  const pseudoDevices = getAudioOutputDevices(devices).filter((device) =>
    isPseudoDefaultDeviceId(device.deviceId),
  );
  return resolveDefaultDevice(
    pseudoDevices,
    getRealAudioOutputDevices(devices),
  );
};

export type ResolveAudioInputDeviceOptions = {
  explicitDeviceId?: string;
  preferBuiltIn: boolean;
};

export const resolveAudioInputDevice = (
  devices: MediaDeviceInfo[],
  options: ResolveAudioInputDeviceOptions,
): MediaDeviceInfo | undefined => {
  const realDevices = getRealAudioInputDevices(devices);
  if (realDevices.length === 0) {
    return undefined;
  }

  if (options.explicitDeviceId) {
    return realDevices.find(
      (device) => device.deviceId === options.explicitDeviceId,
    );
  }

  if (options.preferBuiltIn) {
    const builtInDevice = realDevices.find(isLikelyBuiltInMicrophoneDevice);
    if (builtInDevice) return builtInDevice;

    const nonBluetoothDevice = realDevices.find(
      (device) => !isLikelyBluetoothAudioDevice(device),
    );
    if (nonBluetoothDevice) return nonBluetoothDevice;
  }

  return resolveDefaultAudioInputDevice(devices) ?? realDevices[0];
};

export type ResolveAudioOutputDeviceOptions = {
  explicitDeviceId?: string;
};

export const resolveAudioOutputDevice = (
  devices: MediaDeviceInfo[],
  options: ResolveAudioOutputDeviceOptions,
): MediaDeviceInfo | undefined => {
  const realDevices = getRealAudioOutputDevices(devices);
  if (realDevices.length === 0) {
    return undefined;
  }

  if (options.explicitDeviceId) {
    return realDevices.find(
      (device) => device.deviceId === options.explicitDeviceId,
    );
  }

  return resolveDefaultAudioOutputDevice(devices) ?? realDevices[0];
};
