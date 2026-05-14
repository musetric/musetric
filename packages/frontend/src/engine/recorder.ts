import type { Store } from '../common/store.js';
import type { EnginePlayer } from './player.js';
import type { EngineState } from './state.js';

export type EngineRecorder = {
  start: (projectId: number) => Promise<void>;
  stop: () => Promise<void>;
  isActive: () => boolean;
};

export type CreateEngineRecorderOptions = {
  context: AudioContext;
  store: Store<EngineState>;
  getPlayer: () => EnginePlayer;
};

export const createEngineRecorder = (
  options: CreateEngineRecorderOptions,
): EngineRecorder => {
  const { context, store, getPlayer } = options;
  let activeStream: MediaStream | undefined = undefined;

  const setRecording = (recording: boolean) => {
    store.update((state) => {
      state.recording = recording;
    });
  };

  const cleanupStream = () => {
    const stream = activeStream;
    activeStream = undefined;
    stream?.getTracks().forEach((track) => {
      track.stop();
    });
  };

  store.subscribe(
    (state) => state.playing,
    (playing) => {
      if (!playing && activeStream) {
        cleanupStream();
        setRecording(false);
      }
    },
  );

  return {
    start: async () => {
      if (activeStream) {
        return;
      }

      if (context.state === 'suspended') {
        await context.resume();
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      activeStream = stream;
      stream.getTracks().forEach((track) => {
        track.addEventListener('ended', () => {
          if (activeStream !== stream) {
            return;
          }
          cleanupStream();
          setRecording(false);
          getPlayer().pause();
        });
      });
      setRecording(true);

      try {
        await getPlayer().play();
      } catch (error) {
        cleanupStream();
        setRecording(false);
        throw error;
      }
    },
    stop: async () => {
      cleanupStream();
      setRecording(false);
      getPlayer().pause();
      return Promise.resolve();
    },
    isActive: () => activeStream !== undefined,
  };
};
