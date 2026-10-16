import {
  createMicrophoneAudioConstraints,
  type RecordingInputSettings,
} from '@musetric/audio/recording';
import {
  type EngineAudioSession,
  type EngineMicrophone,
  setAudioSessionType,
} from './engineAudioSession.js';

const readMediaDevices = (): MediaDevices | undefined =>
  'mediaDevices' in navigator ? navigator.mediaDevices : undefined;

export const createWebAudioSession = (
  context: AudioContext,
): EngineAudioSession => {
  const streams = new Map<EngineMicrophone, MediaStream>();
  let openingStreams = 0;

  const apply = () => {
    setAudioSessionType(
      streams.size + openingStreams > 0 ? 'auto' : 'playback',
    );
  };

  apply();

  return {
    openMicrophone: async (request) => {
      const { deviceId } = request;
      openingStreams += 1;
      apply();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: createMicrophoneAudioConstraints({
            deviceId,
            sampleRate: context.sampleRate,
          }),
        });
        const microphone: EngineMicrophone = {
          getSettings: () => {
            const [track] = stream.getAudioTracks();
            const settings: RecordingInputSettings = track.getSettings();
            return settings;
          },
          createSource: () => context.createMediaStreamSource(stream),
        };
        streams.set(microphone, stream);
        return microphone;
      } finally {
        openingStreams -= 1;
        apply();
      }
    },
    closeMicrophone: (microphone) => {
      const stream = streams.get(microphone);
      if (!stream) {
        return;
      }
      for (const track of stream.getTracks()) {
        track.stop();
      }
      streams.delete(microphone);
      apply();
    },
    enumerateDevices: async () => {
      const mediaDevices = readMediaDevices();
      if (!mediaDevices) {
        return [];
      }
      const devices = await mediaDevices.enumerateDevices();
      return devices.filter(
        (device) =>
          device.kind === 'audioinput' || device.kind === 'audiooutput',
      );
    },
    subscribeDevices: (listener) => {
      const mediaDevices = readMediaDevices();
      mediaDevices?.addEventListener('devicechange', listener);
      return () => {
        mediaDevices?.removeEventListener('devicechange', listener);
      };
    },
  };
};
