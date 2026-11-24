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
  isPlaying,
  isRecording,
} from '../state.js';
import { createEngineCommandQueue } from './commandQueue.js';
import { createEnginePlayerLoop, type EnginePlayerLoop } from './loop.js';
import {
  createEnginePlayback,
  createEngineStubPlayback,
  type EnginePlayback,
} from './playback.js';
import { type EnginePositionWriter } from './position.js';
import { createEnginePlayerRange, type EnginePlayerRange } from './range.js';
import { createEngineRecorder, type EngineRecorder } from './recorder.js';
import { createEngineSessionMachine } from './session.js';
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
  const session = createEngineSessionMachine(store);
  const queue = createEngineCommandQueue(store);

  const getEngineRecorder = () =>
    assertDefined(engineRecorder, 'Player is not booted');

  const startPlayback = createStartPlayback({
    store,
    session,
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
        applyMotion: session.applyMotion,
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
        endTake: session.endTake,
        getDecoder,
        getEnginePlayback: () => enginePlayback,
      });
      await enginePlayback.boot();
    },
    play: async () =>
      queue.run(async () => {
        store.update((draft) => {
          draft.rangeRepeat = 'cycle';
          draft.rangeStopFrame = undefined;
        });
        await startPlayback();
      }),
    stop: async () => {
      if (store.get().take === 'arming') {
        getEngineRecorder().cancel();
      }
      return queue.runStop(async () => {
        const recording = isRecording(store.get());
        session.beginStop();
        try {
          if (recording) {
            await getEngineRecorder().stop();
          } else {
            await enginePlayback.stop();
          }
        } finally {
          session.settleStop();
        }
      });
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
    record: async (projectId) =>
      queue.run(async () => {
        const currentState = store.get();
        if (isRecording(currentState)) {
          return;
        }

        const playing = isPlaying(currentState);
        session.beginTake();
        try {
          if (await getEngineRecorder().record(projectId, !playing)) {
            session.settleTake();
          } else {
            session.failTake(playing);
          }
        } catch (error) {
          session.failTake(playing);
          throw error;
        }
      }),
    stopRecording: async () =>
      queue.run(async () => {
        if (!isRecording(store.get())) {
          return;
        }

        session.beginDrain();
        try {
          await getEngineRecorder().finish();
        } finally {
          session.settleDrain();
        }
      }),
    ...createEnginePlayerSettings({
      store,
      getEnginePlayback: () => enginePlayback,
    }),
    ...createEnginePlayerRange({
      store,
      readPosition: () => position.read(),
      seek: (frameIndex) => {
        ref.seek(frameIndex, 'player');
      },
      queue,
      startPlayback,
    }),
    ...createEnginePlayerLoop({
      store,
      session,
      queue,
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
