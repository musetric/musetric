import { assertDefined, nextNumber } from '@musetric/utils';
import { type EngineAudioOutput } from '../audioOutput/index.js';
import { type EngineAudioSession } from '../audioSession/index.js';
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
import { createEnginePlayerRange, type EnginePlayerRange } from './range.js';
import { createEngineRecorder, type EngineRecorder } from './recorder.js';
import { createStartPlayback } from './startPlayback.js';
import { type TakeTarget } from './takeShift.cross.js';
import { encodeMonoWav } from './wav.js';

export type EnginePlayer = EnginePlayerLoop &
  EnginePlayerRange & {
    boot: () => Promise<void>;
    play: () => Promise<void>;
    stop: () => Promise<void>;
    seek: (frameIndex: number, origin: EngineSeekOrigin) => void;
    setFrozen: (frozen: boolean) => void;
    record: (projectId: number) => Promise<void>;
    stopRecording: () => Promise<void>;
    exportRecording: (target: TakeTarget) => Promise<File | undefined>;
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
  audioOutput: EngineAudioOutput;
  audioSession: EngineAudioSession;
  store: Store<EngineState>;
  decoderPort: MessagePort;
  getDecoder: () => EngineDecoder;
  playheadPort: MessagePort;
  playheadPorts: MessagePort[];
};

export const createEnginePlayer = (
  options: CreateEnginePlayerOptions,
): EnginePlayer => {
  const { context, audioOutput, store, decoderPort, getDecoder } = options;
  const { playheadPort, playheadPorts } = options;
  let enginePlayback: EnginePlayback = createEngineStubPlayback();
  let engineRecorder: EngineRecorder | undefined = undefined;

  const getEngineRecorder = () =>
    assertDefined(engineRecorder, 'Player is not booted');

  const getDecoderValue = () => getDecoder();

  const startPlayback = createStartPlayback({
    store,
    getDecoder,
    getEnginePlayback: () => enginePlayback,
  });

  const ref: EnginePlayer = {
    boot: async () => {
      enginePlayback = await createEnginePlayback({
        context,
        audioOutput,
        store,
        decoderPort,
        playheadPort,
        playheadPorts,
        onPlaybackEnded: () => {
          const state = store.get();
          if (!state.isSlave) {
            getDecoderValue().sendPlayerStop();
          }
        },
        onRecordingPassStarted: () => {
          engineRecorder?.handlePassStarted();
        },
        onRecordingPassEnded: (complete) => {
          engineRecorder?.handlePassEnded(complete);
        },
      });
      engineRecorder = createEngineRecorder({
        context,
        audioSession: options.audioSession,
        store,
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
    seek: (requestedFrameIndex, origin) => {
      const frameIndex = clampToRange(requestedFrameIndex, store.get().range);
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

      const { playing } = currentState;
      store.update((draft) => {
        draft.recording = true;
        draft.playing = true;
        draft.playerCommandPending = true;
      });
      try {
        getDecoderValue().sendPlayerRecord();
        await getEngineRecorder().record(projectId, !playing);
      } catch (error) {
        const state = store.get();
        if (!state.isSlave && !playing) {
          getDecoderValue().sendPlayerStop();
        } else if (!state.isSlave && state.playing) {
          getDecoderValue().sendPlayerPlay();
        }
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
      if (
        currentState.playerCommandPending ||
        !currentState.recording ||
        currentState.isSlave
      ) {
        return;
      }

      store.update((draft) => {
        draft.playerCommandPending = true;
      });
      try {
        await getEngineRecorder().finish();
        const state = store.get();
        if (!state.isSlave && state.playing) {
          getDecoderValue().sendPlayerPlay();
        }
      } finally {
        store.update((draft) => {
          draft.playerCommandPending = false;
        });
      }
    },
    ...createEnginePlayerRange({
      store,
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
    exportRecording: async (target) => {
      const samples = await getDecoderValue().exportRecording(target);
      if (samples.every((sample) => sample === 0)) {
        return undefined;
      }
      return new File(
        [encodeMonoWav(samples, context.sampleRate)],
        'recording.wav',
        { type: 'audio/wav' },
      );
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

  return ref;
};
