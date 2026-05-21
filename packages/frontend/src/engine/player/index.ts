import { nextNumber } from '@musetric/resource-utils';
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
  applyRemoteStop: () => Promise<void>;
  applyRemoteFrameIndex: (
    frameIndex: number,
    frozen: boolean,
    revision: number,
    source: 'playback' | 'user',
  ) => void;
  applyRemotePlayState: (state: {
    playing: boolean;
    recording: boolean;
  }) => Promise<void>;
  applyRemoteSyncState: (state: {
    isSlave: boolean;
    playing: boolean;
    recording: boolean;
    frozen: boolean;
    frameIndex: number;
    revision: number;
  }) => Promise<void>;
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

  const getDecoderValue = () => getDecoder();

  return {
    boot: async () => {
      enginePlayback = await createEnginePlayback({
        context,
        store,
        decoderPort,
        onFrameIndexChanged: (frameIndex) => {
          const state = store.get();
          if (state.playing && !state.isSlave) {
            getDecoderValue().sendPlayerFrameIndex({
              frameIndex,
              frozen: state.frozen,
              revision: state.backendRevision,
              source: 'playback',
            });
          }
        },
        onPlaybackEnded: () => {
          const state = store.get();
          if (!state.isSlave) {
            getDecoderValue().sendPlayerStop();
          }
        },
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
      const currentState = store.get();
      if (
        currentState.playerCommandPending ||
        currentState.playing ||
        currentState.isSlave
      ) {
        return;
      }

      store.update((draft) => {
        draft.playing = true;
        draft.playerCommandPending = true;
      });
      try {
        getDecoderValue().sendPlayerPlay();
        await enginePlayback.play();
      } catch (error) {
        getDecoderValue().sendPlayerStop();
        store.update((draft) => {
          draft.playing = false;
        });
        throw error;
      } finally {
        store.update((draft) => {
          draft.playerCommandPending = false;
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
        state.isSlave = false;
        state.playerCommandPending = true;
      });
      try {
        if (recording) {
          await getEngineRecorder().stop();
        } else {
          await enginePlayback.stop();
        }
        getDecoderValue().sendPlayerStop();
      } finally {
        store.update((state) => {
          state.playerCommandPending = false;
        });
      }
    },
    seek: (frameIndex, origin) => {
      store.update((state) => {
        state.frameIndex = frameIndex;
        state.playerFrameIndexPending = true;
        state.seekEvent = {
          revision: nextNumber(state.seekEvent.revision),
          frameIndex,
          origin,
        };
      });
      enginePlayback.seek(frameIndex);
      const state = store.get();
      getDecoderValue().sendPlayerFrameIndex({
        frameIndex,
        frozen: state.frozen,
        revision: state.backendRevision,
        source: 'user',
      });
    },
    setFrozen: (frozen) => {
      store.update((state) => {
        state.playerFrameIndexPending = true;
      });
      enginePlayback.setFrozen(frozen);
      const state = store.get();
      getDecoderValue().sendPlayerFrameIndex({
        frameIndex: state.frameIndex,
        frozen,
        revision: state.backendRevision,
        source: 'user',
      });
    },
    record: async (projectId) => {
      const currentState = store.get();
      if (
        currentState.playerCommandPending ||
        currentState.recording ||
        currentState.isSlave
      ) {
        return;
      }

      store.update((draft) => {
        draft.recording = true;
        draft.playing = true;
        draft.playerCommandPending = true;
      });
      try {
        getDecoderValue().sendPlayerRecord();
        await getEngineRecorder().record(projectId);
      } catch (error) {
        if (!store.get().isSlave) {
          getDecoderValue().sendPlayerStop();
        }
        store.update((draft) => {
          draft.recording = false;
          draft.playing = false;
        });
        throw error;
      } finally {
        store.update((draft) => {
          draft.playerCommandPending = false;
        });
      }
    },
    applyRemoteStop: async () => {
      const { recording: wasRecording } = store.get();
      store.update((state) => {
        state.isSlave = false;
        state.playing = false;
        state.recording = false;
        state.playerCommandPending = false;
        state.playerFrameIndexPending = false;
      });
      if (wasRecording) {
        await getEngineRecorder().stop();
      } else {
        await enginePlayback.stop();
      }
    },
    applyRemoteFrameIndex: (frameIndex, frozen, revision, source) => {
      const currentState = store.get();
      if (
        source === 'playback' &&
        (currentState.playerFrameIndexPending ||
          currentState.backendRevision !== revision)
      ) {
        return;
      }

      store.update((state) => {
        state.backendRevision = revision;
        state.playerFrameIndexPending = false;
        state.frameIndex = frameIndex;
        state.frozen = frozen;
        state.seekEvent = {
          revision: nextNumber(state.seekEvent.revision),
          frameIndex,
          origin: 'remote',
        };
      });
      enginePlayback.seek(frameIndex);
      enginePlayback.setFrozen(frozen);
    },
    applyRemotePlayState: async (state) => {
      const currentState = store.get();
      if (currentState.recording) {
        await getEngineRecorder().stop();
      } else if (currentState.playing) {
        await enginePlayback.stop();
      }
      store.update((s) => {
        s.isSlave = true;
        s.playing = state.playing;
        s.recording = state.recording;
        s.playerCommandPending = false;
        s.playerFrameIndexPending = false;
      });
    },
    applyRemoteSyncState: async (state) => {
      const currentState = store.get();
      if (state.isSlave && currentState.recording) {
        await getEngineRecorder().stop();
      } else if (state.isSlave && currentState.playing) {
        await enginePlayback.stop();
      }

      store.update((s) => {
        s.backendRevision = state.revision;
        s.playerFrameIndexPending = false;
        s.isSlave = state.isSlave;
        s.playing = state.playing;
        s.recording = state.recording;
        s.frozen = state.frozen;
        s.frameIndex = state.frameIndex;
        s.seekEvent = {
          revision: nextNumber(s.seekEvent.revision),
          frameIndex: state.frameIndex,
          origin: 'remote',
        };
        s.playerCommandPending = false;
      });
      enginePlayback.seek(state.frameIndex);
      enginePlayback.setFrozen(state.frozen);
    },
  };
};
