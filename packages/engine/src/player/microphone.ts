import {
  createMicrophoneAudioConstraints,
  mobileUserAgentPattern,
  resolveAudioInputDevice,
} from '@musetric/audio/recording';

export const stopMediaStream = (stream: MediaStream) => {
  for (const track of stream.getTracks()) {
    track.stop();
  }
};

export const getAudioDevices = async () => {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter(
    (device) => device.kind === 'audioinput' || device.kind === 'audiooutput',
  );
};

export const resolvePreferredStream = async (
  stream: MediaStream,
  devices: MediaDeviceInfo[],
  sampleRate: number,
): Promise<MediaStream> => {
  const preferredDevice = resolveAudioInputDevice(devices, {
    preferBuiltIn: mobileUserAgentPattern.test(navigator.userAgent),
  });
  if (!preferredDevice) {
    return stream;
  }
  const [currentTrack] = stream.getAudioTracks();
  const currentDeviceId = currentTrack.getSettings().deviceId;
  if (preferredDevice.deviceId === currentDeviceId) {
    return stream;
  }
  stopMediaStream(stream);
  return navigator.mediaDevices.getUserMedia({
    audio: createMicrophoneAudioConstraints({
      deviceId: preferredDevice.deviceId,
      sampleRate,
    }),
  });
};
