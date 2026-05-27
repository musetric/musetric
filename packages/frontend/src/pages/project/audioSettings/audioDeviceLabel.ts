export const getAudioDeviceLabel = (
  device: MediaDeviceInfo,
  fallback: string,
): string => device.label || fallback;
