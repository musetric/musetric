import type { Store } from '../../common/store.js';
import type { EngineDecoder } from '../decoder.js';
import { type EngineSeekOrigin, type EngineState } from '../state.js';
import {
  createEnginePlayback,
  createEngineStubPlayback,
  type EnginePlayback,
} from './playback.js';
import { createEngineRecorder, type EngineRecorder } from './recorder.js';

export type EnginePlayer = {
  boot: () => Promise<void>;
  play: () => Promise<void>;
  stop: () => Promise<void>;
  seek: (frameIndex: number, origin: EngineSeekOrigin) => void;
  setFrozen: (frozen: boolean) => void;
  record: (projectId: number) => Promise<void>;
};

export type CreateEnginePlayerOptions = {
  context: AudioContext;
  store: Store<EngineState>;
  decoderPort: MessagePort;
  getDecoder: () => EngineDecoder;
};

export const createEnginePlayer = (
  options: CreateEnginePlayerOptions,
): EnginePlayer => {
  const { context, store, decoderPort, getDecoder } = options;
  let enginePlayback: EnginePlayback = createEngineStubPlayback();
  let engineRecorder: EngineRecorder | undefined = undefined;

  const getEngineRecorder = () => {
    if (!engineRecorder) {
      throw new Error('Player is not booted');
    }

    return engineRecorder;
  };

  return {
    boot: async () => {
      enginePlayback = await createEnginePlayback({
        context,
        store,
        decoderPort,
      });
      engineRecorder = createEngineRecorder({
        context,
        store,
        getDecoder,
        getEnginePlayback: () => enginePlayback,
      });
      await enginePlayback.boot();
    },
    play: async () => {
      if (store.get().playerCommandPending || store.get().playing) {
        return;
      }

      store.update((state) => {
        state.playing = true;
        state.playerCommandPending = true;
      });
      try {
        await enginePlayback.play();
      } finally {
        store.update((state) => {
          state.playerCommandPending = false;
        });
      }
    },
    stop: async () => {
      if (store.get().playerCommandPending) {
        return;
      }

      const { recording } = store.get();
      store.update((state) => {
        state.playing = false;
        state.playerCommandPending = true;
      });
      try {
        if (recording) {
          await getEngineRecorder().stop();
          return;
        }

        await enginePlayback.stop();
      } finally {
        store.update((state) => {
          state.playerCommandPending = false;
        });
      }
    },
    seek: (frameIndex, origin) => {
      store.update((state) => {
        state.frameIndex = frameIndex;
        state.seekEvent = {
          revision: state.seekEvent.revision + 1,
          frameIndex,
          origin,
        };
      });
      enginePlayback.seek(frameIndex);
    },
    setFrozen: (frozen) => {
      enginePlayback.setFrozen(frozen);
    },
    record: async (projectId) => {
      if (store.get().playerCommandPending || store.get().recording) {
        return;
      }

      store.update((state) => {
        state.recording = true;
        state.playing = true;
        state.playerCommandPending = true;
      });
      try {
        await getEngineRecorder().record(projectId);
      } catch (error) {
        store.update((state) => {
          state.recording = false;
          state.playing = false;
        });
        throw error;
      } finally {
        store.update((state) => {
          state.playerCommandPending = false;
        });
      }
    },
  };
};
