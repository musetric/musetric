import { type api } from '@musetric/api';
import {
  type ControlledPromise,
  createControlledPromise,
} from '@musetric/utils';
import { createLazyMount } from '@musetric/utils/cross/lazyMount';
import { type Store } from '../common/store.js';
import { type EngineStoreState } from '../ownState.js';
import { type PlayerWindow } from '../player/protocol.cross.js';
import projectWorkerUrl from './project.worker.ts?worker&url';
import {
  engineProjectChannel,
  type SettledLoopTry,
  type TakeRefusal,
} from './protocol.cross.js';

const realtimeStopDelayMs = 10_000;

type Unmount = () => void;

export type EngineProject = {
  port: ReturnType<typeof engineProjectChannel.outbound<Worker>>;
  boot: () => Promise<void>;
  connectPlayer: (playerPort: MessagePort) => Promise<boolean>;
  mount: (projectId: number) => Unmount;
  requestTarget: (window: PlayerWindow) => void;
  startRecordingStream: (options: {
    takeId: string;
    projectId: number;
    sampleRate: number;
    frameCount: number;
    latencyFrameCount: number;
    tempo: number;
    transpose: number;
    octave: number;
    draft: boolean;
    port: MessagePort;
  }) => void;
  finishRecordingStream: (takeId: string, sequence: number) => Promise<void>;
  settleLoopTry: (keep: boolean) => Promise<SettledLoopTry | undefined>;
  selectLoopTry: (tryId: string | undefined) => void;
  deleteLoopTry: (tryId: string) => void;
  discardLoopTries: () => void;
  insertLoopTry: (projectId: number, tryId: string) => Promise<boolean>;
  sendRecordingUndo: () => void;
  sendRecordingRedo: () => void;
};

export type CreateEngineProjectOptions = {
  store: Store<EngineStoreState>;
  sampleRate: number;
  spectrogramPort: MessagePort;
  onRecordingPeaksChanged: (message: {
    recordingId: number;
    startPeakIndex: number;
    peaks: Float32Array<ArrayBuffer>;
  }) => void;
  onRecordingsChanged: (recordings: api.recording.Item[]) => void;
  onRecordingContentChanged: (recordingId: number) => void;
  onTakeRefused: (reason: TakeRefusal, streaming: boolean) => void;
  onRealtimeLost: () => void;
};

export const createEngineProject = (
  options: CreateEngineProjectOptions,
): EngineProject => {
  const {
    store,
    spectrogramPort,
    onRecordingPeaksChanged,
    onRecordingsChanged,
    onRecordingContentChanged,
    onTakeRefused,
    onRealtimeLost,
  } = options;
  const worker = new Worker(projectWorkerUrl, { type: 'module' });
  const port = engineProjectChannel.outbound(worker);
  const bootPromise: ControlledPromise<void> = createControlledPromise<void>();
  let playerPromise: ControlledPromise<boolean> | undefined = undefined;
  let mountPromise: ControlledPromise<void> | undefined = undefined;
  const takeFinishes = new Map<string, ControlledPromise<void>>();
  let streamingTakeId: string | undefined = undefined;
  let loopTrySettlePromise:
    ControlledPromise<SettledLoopTry | undefined> | undefined = undefined;
  let loopTryInsertPromise: ControlledPromise<boolean> | undefined = undefined;
  const runtimeSampleRate = options.sampleRate;
  let realtimeDropped = false;
  let realtimeStop: number | undefined = undefined;

  const cancelRealtimeStop = () => {
    window.clearTimeout(realtimeStop);
    realtimeStop = undefined;
  };

  const showRealtimeLoss = () => {
    if (realtimeStop !== undefined || document.visibilityState !== 'visible') {
      return;
    }
    store.update((state) => {
      state.statuses.realtime = 'error';
    });
    realtimeStop = window.setTimeout(onRealtimeLost, realtimeStopDelayMs);
  };

  document.addEventListener('visibilitychange', () => {
    if (!realtimeDropped) {
      return;
    }
    if (document.visibilityState !== 'visible') {
      cancelRealtimeStop();
      return;
    }
    port.methods.reconnectRealtime();
  });

  port.instance.onerror = () => {
    store.update((state) => {
      state.statuses.project = 'error';
    });
  };

  port.bindHandlers({
    booted: () => {
      bootPromise.resolve();
    },
    playerConnected: (message) => {
      playerPromise?.resolve(message.mounted);
      playerPromise = undefined;
    },
    setState: (message) => {
      store.update((state) => {
        state.statuses.project = message.status;
      });
      mountPromise?.resolve();
      mountPromise = undefined;
    },
    setRealtimeState: (message) => {
      realtimeDropped = message.status === 'error';
      if (realtimeDropped) {
        showRealtimeLoss();
        return;
      }
      cancelRealtimeStop();
      store.update((state) => {
        state.statuses.realtime = message.status;
      });
    },
    mounted: (message) => {
      store.update((state) => {
        state.statuses.project = 'success';
        state.frameCount = message.frameCount;
        state.duration = message.frameCount / runtimeSampleRate;
      });
      mountPromise?.resolve();
      mountPromise = undefined;
    },
    unmounted: () => {
      realtimeDropped = false;
      cancelRealtimeStop();
      store.update((state) => {
        state.statuses.project = 'pending';
        state.statuses.realtime = 'pending';
        state.takeRefusal = undefined;
        state.frameCount = undefined;
        state.duration = 0;
        state.recordings = [];
        state.range = undefined;
        state.rangeRepeat = 'cycle';
        state.rangeStopFrame = undefined;
        state.loopStage = undefined;
        state.viewWindow = undefined;
        state.loopTries = [];
        state.loopSelectedTryId = undefined;
        state.loopTryPhase = undefined;
      });
    },
    recordingStreamFinished: (message) => {
      takeFinishes.get(message.takeId)?.resolve();
      takeFinishes.delete(message.takeId);
    },
    takeRefused: (message) => {
      console.error('The host refused the take', message.reason);
      onTakeRefused(message.reason, message.takeId === streamingTakeId);
    },
    recordingPeaksChanged: onRecordingPeaksChanged,
    recordingsChanged: (message) => {
      onRecordingsChanged(message.recordings);
    },
    recordingContentChanged: (message) => {
      onRecordingContentChanged(message.recordingId);
    },
    loopTrySettled: (message) => {
      loopTrySettlePromise?.resolve(message.loopTry);
      loopTrySettlePromise = undefined;
    },
    loopTryInserted: (message) => {
      loopTryInsertPromise?.resolve(message.inserted);
      loopTryInsertPromise = undefined;
    },
  });

  return {
    port,
    boot: async () => {
      port.methods.boot({ spectrogramPort });

      return bootPromise.promise;
    },
    connectPlayer: async (playerPort) => {
      await bootPromise.promise;
      playerPromise = createControlledPromise<boolean>();
      const { promise } = playerPromise;
      port.methods.connectPlayer({ playerPort });
      return await promise;
    },
    mount: createLazyMount((projectId: number) => {
      mountPromise = createControlledPromise<void>();
      port.methods.mount({
        projectId,
        sampleRate: runtimeSampleRate,
      });

      return () => {
        port.methods.unmount();
      };
    }),
    requestTarget: (window) => {
      port.methods.requestTarget(window);
    },
    startRecordingStream: (recording) => {
      streamingTakeId = recording.draft ? undefined : recording.takeId;
      port.methods.startRecordingStream(recording);
    },
    finishRecordingStream: async (takeId, sequence) => {
      if (streamingTakeId === takeId) {
        streamingTakeId = undefined;
      }
      const finish = createControlledPromise<void>();
      takeFinishes.set(takeId, finish);
      port.methods.finishRecordingStream({ takeId, sequence });
      await finish.promise;
    },
    settleLoopTry: async (keep) => {
      loopTrySettlePromise = createControlledPromise<
        SettledLoopTry | undefined
      >();
      const { promise } = loopTrySettlePromise;
      port.methods.settleLoopTry({ keep });
      return await promise;
    },
    selectLoopTry: (tryId) => {
      port.methods.selectLoopTry({ tryId });
    },
    deleteLoopTry: (tryId) => {
      port.methods.deleteLoopTry({ tryId });
    },
    discardLoopTries: () => {
      port.methods.discardLoopTries();
    },
    insertLoopTry: async (projectId, tryId) => {
      loopTryInsertPromise = createControlledPromise<boolean>();
      const { promise } = loopTryInsertPromise;
      port.methods.insertLoopTry({
        projectId,
        tryId,
        sampleRate: runtimeSampleRate,
        frameCount: store.get().frameCount ?? 0,
      });
      return await promise;
    },
    sendRecordingUndo: () => {
      port.methods.sendRecordingUndo();
    },
    sendRecordingRedo: () => {
      port.methods.sendRecordingRedo();
    },
  };
};
