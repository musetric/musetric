import {
  createMicrophoneAudioConstraints,
  mobileUserAgentPattern,
  resolveAudioInputDevice,
} from '@musetric/audio/recording';
import { type EngineAudioSession } from '../audioSession/index.js';

export const getAudioDevices = async () => {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter(
    (device) => device.kind === 'audioinput' || device.kind === 'audiooutput',
  );
};

export type PreferredStreamOptions = {
  audioSession: EngineAudioSession;
  stream: MediaStream;
  devices: MediaDeviceInfo[];
  sampleRate: number;
};

export const resolvePreferredStream = async (
  options: PreferredStreamOptions,
): Promise<MediaStream> => {
  const { audioSession, stream, devices, sampleRate } = options;
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
  audioSession.closeMicrophone(stream);
  return audioSession.openMicrophone({
    audio: createMicrophoneAudioConstraints({
      deviceId: preferredDevice.deviceId,
      sampleRate,
    }),
  });
};
