import { createEngineSessionMachine } from '@musetric/transport';
import { assertDefined } from '@musetric/utils';
import { type EngineAudioOutput } from '../audioOutput/index.js';
import { type EngineOutputClock } from '../audioOutput/outputClock.js';
import { type EngineAudioSession } from '../audioSession/engineAudioSession.js';
import { type Store } from '../common/store.js';
import { type EngineStoreState } from '../ownState.js';
import { type EngineProject } from '../project/index.js';
import { clampToRange, isPlaying, isRecording } from '../state.js';
import { createEngineCommandQueue } from './commandQueue.js';
import { createEnginePlayerLoop, type EnginePlayerLoop } from './loop.js';
import { createEnginePlayback, type EnginePlayback } from './playback.js';
import { type EnginePositionWriter } from './position.js';
import { createEnginePlayerRange, type EnginePlayerRange } from './range.js';
import { createEngineRecorder, type EngineRecorder } from './recorder.js';
import { type EngineSeekOrigin, type EngineSeeksWriter } from './seeks.js';
import {
  createEnginePlayerSettings,
  type EnginePlayerSettings,
} from './settings.js';
import { createStartPlayback } from './startPlayback.js';
import { createEngineStubPlayback } from './stubPlayback.js';

const heldRequestMs = 100;

export type EnginePlayer = EnginePlayerLoop &
  EnginePlayerRange &
  EnginePlayerSettings & {
    boot: () => Promise<void>;
    play: () => Promise<void>;
    stop: () => Promise<void>;
    seek: (frameIndex: number, origin: EngineSeekOrigin) => void;
    hold: () => () => void;
    record: (projectId: number) => Promise<void>;
    stopRecording: () => Promise<void>;
  };

export type EnginePlayerPorts = {
  dataPort: MessagePort;
  playheadPort: MessagePort;
  mounted: boolean;
};

export type CreateEnginePlayerOptions = {
  getContext: () => AudioContext;
  audioOutput: EngineAudioOutput;
  outputClock: EngineOutputClock;
  audioSession: EngineAudioSession;
  store: Store<EngineStoreState>;
  getProject: () => EngineProject;
  position: EnginePositionWriter;
  seeks: EngineSeeksWriter;
  connect: () => Promise<EnginePlayerPorts>;
  rebuildOutput: () => Promise<void>;
};

export const createEnginePlayer = (
  options: CreateEnginePlayerOptions,
): EnginePlayer => {
  const { getContext, audioOutput, outputClock, store, getProject } = options;
  const { position, seeks } = options;
  let enginePlayback: EnginePlayback = createEngineStubPlayback();
  let engineRecorder: EngineRecorder | undefined = undefined;
  let heldSeek: number | undefined = undefined;
  let heldRequest: ReturnType<typeof setTimeout> | undefined = undefined;
  let armingStops = 0;
  let holds = 0;
  const session = createEngineSessionMachine(store, () => crypto.randomUUID());
  const queue = createEngineCommandQueue(store);

  const getEngineRecorder = () =>
    assertDefined(engineRecorder, 'Player is not booted');

  const stop = async () => {
    if (store.get().take === 'arming') {
      armingStops += 1;
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
  };

  const bootPlayback = async (): Promise<boolean> => {
    const context = getContext();
    enginePlayback = await createEnginePlayback({
      ...(await options.connect()),
      context,
      audioOutput,
      outputClock,
      store,
      position,
      seeks,
      applyMotion: session.applyMotion,
      onRecordingPassStarted: () => {
        engineRecorder?.handlePassStarted();
      },
      onRecordingPassEnded: (complete) => {
        engineRecorder?.handlePassEnded(complete);
      },
      onFailed: () => {
        session.applyMotion('stopped');
        void stop();
      },
    });
    engineRecorder = createEngineRecorder({
      context,
      outputClock,
      audioSession: options.audioSession,
      store,
      position,
      seeks,
      endTake: session.endTake,
      getProject,
      getEnginePlayback: () => enginePlayback,
    });
    return enginePlayback.boot();
  };

  const restart = async (rebuildOutput: boolean): Promise<boolean> => {
    try {
      if (rebuildOutput) {
        await options.rebuildOutput();
      }
      return await bootPlayback();
    } catch (error) {
      console.error('The player did not start again', error);
      return false;
    }
  };

  const revive = async (): Promise<boolean> => {
    if (store.get().statuses.player !== 'error') {
      return true;
    }
    if (!(await restart(false)) && !(await restart(true))) {
      return false;
    }
    enginePlayback.seek(position.read());
    return true;
  };

  const recordTake = async (
    projectId: number,
    takeId: string,
    startPlayback: boolean,
    pass: boolean,
  ) => {
    const stops = armingStops;
    return (
      (await revive()) &&
      stops === armingStops &&
      (await getEngineRecorder().record({
        projectId,
        takeId,
        startPlayback,
        pass,
      }))
    );
  };

  const startPlayback = createStartPlayback({
    store,
    session,
    revive,
    getEnginePlayback: () => enginePlayback,
  });

  const requestTarget = (frameIndex: number) => {
    const { range, rangeRepeat } = store.get();
    getProject().requestTarget({
      frameIndex,
      loop: rangeRepeat === 'cycle' ? range : undefined,
    });
  };

  const setFrozen = (frozen: boolean) => {
    if (!frozen && heldSeek !== undefined) {
      if (heldRequest !== undefined) {
        clearTimeout(heldRequest);
        heldRequest = undefined;
        requestTarget(heldSeek);
      }
      enginePlayback.seek(heldSeek);
      heldSeek = undefined;
    }
    enginePlayback.setFrozen(frozen);
  };

  const ref: EnginePlayer = {
    boot: async () => {
      await bootPlayback();
    },
    play: async () =>
      queue.run(async () => {
        store.update((draft) => {
          draft.rangeRepeat = 'cycle';
          draft.rangeStopFrame = undefined;
        });
        await startPlayback();
      }),
    stop,
    seek: (requestedFrameIndex, origin) => {
      const { range } = store.get();
      const frameIndex = clampToRange(requestedFrameIndex, range);
      position.write(frameIndex);
      seeks.push(frameIndex, origin);
      clearTimeout(heldRequest);
      heldRequest = undefined;
      if (store.get().frozen) {
        heldSeek = frameIndex;
        heldRequest = setTimeout(() => {
          heldRequest = undefined;
          requestTarget(frameIndex);
        }, heldRequestMs);
        return;
      }
      requestTarget(frameIndex);
      enginePlayback.seek(frameIndex);
    },
    hold: () => {
      holds += 1;
      if (holds === 1) {
        setFrozen(true);
        const state = store.get();
        if (isPlaying(state) && !isRecording(state)) {
          ref.seek(position.read(), 'hold');
        }
      }
      let held = true;
      return () => {
        if (!held) {
          return;
        }
        held = false;
        holds -= 1;
        if (holds === 0) {
          setFrozen(false);
        }
      };
    },
    record: async (projectId) =>
      queue.run(async () => {
        const currentState = store.get();
        if (isRecording(currentState)) {
          return;
        }

        const playing = isPlaying(currentState);
        const takeId = session.beginTake();
        try {
          if (await recordTake(projectId, takeId, !playing, false)) {
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
      getProject,
      getEngineRecorder,
      recordTake,
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
