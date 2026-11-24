import { assertDefined, nextNumber } from '@musetric/utils';
import { type EngineAudioOutput } from '../audioOutput/index.js';
import { type EngineOutputClock } from '../audioOutput/outputClock.js';
import { type EngineAudioSession } from '../audioSession/engineAudioSession.js';
import { type Store } from '../common/store.js';
import { type EngineDecoder } from '../decoder/index.js';
import {
  clampToRange,
  type EngineSeekOrigin,
  type EngineState,
} from '../state.js';
import { createEnginePlayerLoop, type EnginePlayerLoop } from './loop.js';
import {
  createEnginePlayback,
  createEngineStubPlayback,
  type EnginePlayback,
} from './playback.js';
import { type EnginePositionWriter } from './position.js';
import { createEnginePlayerRange, type EnginePlayerRange } from './range.js';
import { createEngineRecorder, type EngineRecorder } from './recorder.js';
import {
  createEnginePlayerSettings,
  type EnginePlayerSettings,
} from './settings.js';
import { createStartPlayback } from './startPlayback.js';

export type EnginePlayer = EnginePlayerLoop &
  EnginePlayerRange &
  EnginePlayerSettings & {
    boot: () => Promise<void>;
    play: () => Promise<void>;
    stop: () => Promise<void>;
    seek: (frameIndex: number, origin: EngineSeekOrigin) => void;
    setFrozen: (frozen: boolean) => void;
    record: (projectId: number) => Promise<void>;
    stopRecording: () => Promise<void>;
  };

export type CreateEnginePlayerOptions = {
  context: AudioContext;
  audioOutput: EngineAudioOutput;
  outputClock: EngineOutputClock;
  audioSession: EngineAudioSession;
  store: Store<EngineState>;
  decoderPort: MessagePort;
  getDecoder: () => EngineDecoder;
  playheadPort: MessagePort;
  playheadPorts: MessagePort[];
  position: EnginePositionWriter;
};

export const createEnginePlayer = (
  options: CreateEnginePlayerOptions,
): EnginePlayer => {
  const { context, audioOutput, outputClock, store, decoderPort, getDecoder } =
    options;
  const { playheadPort, playheadPorts, position } = options;
  let enginePlayback: EnginePlayback = createEngineStubPlayback();
  let engineRecorder: EngineRecorder | undefined = undefined;
  let heldSeek: number | undefined = undefined;

  const getEngineRecorder = () =>
    assertDefined(engineRecorder, 'Player is not booted');

  const startPlayback = createStartPlayback({
    store,
    getEnginePlayback: () => enginePlayback,
  });

  const ref: EnginePlayer = {
    boot: async () => {
      enginePlayback = await createEnginePlayback({
        context,
        audioOutput,
        outputClock,
        store,
        decoderPort,
        playheadPort,
        playheadPorts,
        position,
        onRecordingPassStarted: () => {
          engineRecorder?.handlePassStarted();
        },
        onRecordingPassEnded: (complete) => {
          engineRecorder?.handlePassEnded(complete);
        },
      });
      engineRecorder = createEngineRecorder({
        context,
        outputClock,
        audioSession: options.audioSession,
        store,
        position,
        getDecoder,
        getEnginePlayback: () => enginePlayback,
      });
      await enginePlayback.boot();
    },
    play: async () => {
      store.update((draft) => {
        draft.rangeRepeat = 'cycle';
        draft.rangeStopFrame = undefined;
      });
      await startPlayback();
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
        } else {
          await enginePlayback.stop();
        }
      } finally {
        store.update((state) => {
          state.playerCommandPending = false;
        });
      }
    },
    seek: (requestedFrameIndex, origin) => {
      const frameIndex = clampToRange(requestedFrameIndex, store.get().range);
      position.write(frameIndex);
      store.update((state) => {
        state.seekEvent = {
          revision: nextNumber(state.seekEvent.revision),
          frameIndex,
          origin,
        };
      });
      if (store.get().frozen) {
        heldSeek = frameIndex;
        return;
      }
      enginePlayback.seek(frameIndex);
    },
    setFrozen: (frozen) => {
      if (!frozen && heldSeek !== undefined) {
        enginePlayback.seek(heldSeek);
        heldSeek = undefined;
      }
      enginePlayback.setFrozen(frozen);
    },
    record: async (projectId) => {
      const currentState = store.get();
      if (currentState.playerCommandPending || currentState.recording) {
        return;
      }

      const { playing } = currentState;
      store.update((draft) => {
        draft.recording = true;
        draft.playing = true;
        draft.playerCommandPending = true;
      });
      try {
        await getEngineRecorder().record(projectId, !playing);
      } catch (error) {
        store.update((draft) => {
          draft.recording = false;
          if (!playing) {
            draft.playing = false;
          }
        });
        throw error;
      } finally {
        store.update((draft) => {
          draft.playerCommandPending = false;
        });
      }
    },
    stopRecording: async () => {
      const currentState = store.get();
      if (currentState.playerCommandPending || !currentState.recording) {
        return;
      }

      store.update((draft) => {
        draft.playerCommandPending = true;
      });
      try {
        await getEngineRecorder().finish();
      } finally {
        store.update((draft) => {
          draft.playerCommandPending = false;
        });
      }
    },
    ...createEnginePlayerSettings(store),
    ...createEnginePlayerRange({
      store,
      readPosition: () => position.read(),
      seek: (frameIndex) => {
        ref.seek(frameIndex, 'player');
      },
      startPlayback,
    }),
    ...createEnginePlayerLoop({
      store,
      getDecoder,
      getEngineRecorder,
      seek: (frameIndex) => {
        ref.seek(frameIndex, 'player');
      },
      setRange: (range) => {
        ref.setRange(range);
      },
    }),
  };

  return ref;
};
