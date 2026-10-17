import {
  createMicrophoneAudioConstraints,
  type RecordingInputSettings,
} from '@musetric/audio/recording';
import { type EngineOutputClock } from '../audioOutput/outputClock.js';
import {
  type EngineAudioSession,
  type EngineMicrophone,
  setAudioSessionType,
} from './engineAudioSession.js';
import {
  canOpenWebMicrophoneSettings,
  openWebMicrophoneSettings,
  readWebMicrophoneDenial,
} from './settings.js';
import {
  createTimedMicrophones,
  type TimedMicrophoneSource,
} from './timedMicrophone.js';

type TrackStats = {
  totalFrames: number;
  averageLatency: number;
};

type TrackWithStats = MediaStreamTrack & {
  stats?: TrackStats;
};

const readMeasuredInputLatency = (stream: MediaStream) => {
  const [track] = stream.getAudioTracks();
  const trackWithStats: TrackWithStats = track;
  const { stats } = trackWithStats;
  if (!stats || stats.totalFrames <= 0 || stats.averageLatency <= 0) {
    return undefined;
  }
  return stats.averageLatency / 1000;
};

const measureWaitMs = 1000;
const measurePollMs = 50;

const waitForInputLatency = async (stream: MediaStream) => {
  const [track] = stream.getAudioTracks();
  const trackWithStats: TrackWithStats = track;
  if (!trackWithStats.stats) {
    return;
  }
  for (
    let waitedMs = 0;
    waitedMs < measureWaitMs && readMeasuredInputLatency(stream) === undefined;
    waitedMs += measurePollMs
  ) {
    await new Promise((resolve) => {
      setTimeout(resolve, measurePollMs);
    });
  }
};

const readMediaDevices = (): MediaDevices | undefined =>
  'mediaDevices' in navigator ? navigator.mediaDevices : undefined;

export const createWebAudioSession = (
  context: AudioContext,
  outputClock: EngineOutputClock,
): EngineAudioSession => {
  const streams = new Map<EngineMicrophone, MediaStream>();
  const timedSources = new Map<EngineMicrophone, TimedMicrophoneSource>();
  const timedMicrophones = createTimedMicrophones(context, outputClock);
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
        const [track] = stream.getAudioTracks();
        const timed = await timedMicrophones
          ?.open(track)
          .catch((error: unknown) => {
            console.error('Failed to time the microphone', error);
            return undefined;
          });
        const microphone: EngineMicrophone = {
          getSettings: () => {
            const settings: RecordingInputSettings = track.getSettings();
            return settings;
          },
          getMeasuredInputLatency: () => readMeasuredInputLatency(stream),
          whenInputLatencyMeasured: async () =>
            timed ? undefined : waitForInputLatency(stream),
          exactRoundTripLatency: timed?.roundTripLatency,
          createSource: () => {
            if (!timed) {
              return context.createMediaStreamSource(stream);
            }
            const source = context.createGain();
            timed.node.connect(source);
            return source;
          },
        };
        streams.set(microphone, stream);
        if (timed) {
          timedSources.set(microphone, timed);
        }
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
      timedSources.get(microphone)?.close();
      timedSources.delete(microphone);
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
    readMicrophoneDenial: readWebMicrophoneDenial,
    canOpenMicrophoneSettings: canOpenWebMicrophoneSettings,
    openMicrophoneSettings: openWebMicrophoneSettings,
  };
};
