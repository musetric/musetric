import { resolveAudioInputDevice } from '@musetric/audio/recording';
import {
  type EngineAudioSession,
  type EngineMicrophone,
} from '../audioSession/engineAudioSession.js';

export const openKnownMicrophone = async (
  audioSession: EngineAudioSession,
  microphoneDeviceId: string | undefined,
): Promise<EngineMicrophone> => {
  const devices = await audioSession.enumerateDevices();
  const device = resolveAudioInputDevice(devices, {
    explicitDeviceId: microphoneDeviceId,
  });
  return audioSession.openMicrophone({
    deviceId: device?.deviceId || microphoneDeviceId,
  });
};

export type PreferredMicrophoneOptions = {
  audioSession: EngineAudioSession;
  microphone: EngineMicrophone;
  devices: MediaDeviceInfo[];
};

export const resolvePreferredMicrophone = async (
  options: PreferredMicrophoneOptions,
): Promise<EngineMicrophone> => {
  const { audioSession, microphone, devices } = options;
  const preferredDevice = resolveAudioInputDevice(devices, {});
  if (!preferredDevice) {
    return microphone;
  }
  if (preferredDevice.deviceId === microphone.getSettings().deviceId) {
    return microphone;
  }
  audioSession.closeMicrophone(microphone);
  return audioSession.openMicrophone({ deviceId: preferredDevice.deviceId });
};
