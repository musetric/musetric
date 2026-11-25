import { type api } from '@musetric/api';
import {
  type ControlledPromise,
  createControlledPromise,
} from '@musetric/utils';
import { createLazyMount } from '@musetric/utils/cross/lazyMount';
import { type Store } from '../common/store.js';
import { type PlayerWindow } from '../player/protocol.cross.js';
import { type EngineState } from '../state.js';
import decoderWorkerUrl from './decoder.worker.ts?worker&url';
import { engineDecoderChannel, type SettledLoopTry } from './protocol.cross.js';

const sanitizeLogMessage = (message: string) =>
  message.replace(/[\r\n\u2028\u2029]/g, ' ');

type Unmount = () => void;

export type EngineDecoder = {
  port: ReturnType<typeof engineDecoderChannel.outbound<Worker>>;
  boot: () => Promise<void>;
  mount: (projectId: number) => Unmount;
  requestTarget: (window: PlayerWindow) => void;
  startRecordingStream: (options: {
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
  finishRecordingStream: (sequence: number) => Promise<void>;
  settleLoopTry: (keep: boolean) => Promise<SettledLoopTry | undefined>;
  selectLoopTry: (tryId: string | undefined) => void;
  deleteLoopTry: (tryId: string) => void;
  discardLoopTries: () => void;
  insertLoopTry: (projectId: number, tryId: string) => Promise<boolean>;
  sendRecordingUndo: () => void;
  sendRecordingRedo: () => void;
};

export type CreateEngineDecoderOptions = {
  store: Store<EngineState>;
  sampleRate: number;
  playerPort: MessagePort;
  spectrogramPort: MessagePort;
  onRecordingPeaksChanged: (message: {
    recordingId: number;
    startPeakIndex: number;
    peaks: Float32Array<ArrayBuffer>;
  }) => void;
  onRecordingsChanged: (recordings: api.recording.Item[]) => void;
  onRecordingContentChanged: (recordingId: number) => void;
  onRecordingStreamFailed: () => void;
};

export const createEngineDecoder = (
  options: CreateEngineDecoderOptions,
): EngineDecoder => {
  const {
    store,
    playerPort,
    spectrogramPort,
    onRecordingPeaksChanged,
    onRecordingsChanged,
    onRecordingContentChanged,
    onRecordingStreamFailed,
  } = options;
  const worker = new Worker(decoderWorkerUrl, { type: 'module' });
  const port = engineDecoderChannel.outbound(worker);
  const bootPromise: ControlledPromise<void> = createControlledPromise<void>();
  let mountPromise: ControlledPromise<void> | undefined = undefined;
  let recordingStreamPromise: ControlledPromise<void> | undefined = undefined;
  let loopTrySettlePromise:
    ControlledPromise<SettledLoopTry | undefined> | undefined = undefined;
  let loopTryInsertPromise: ControlledPromise<boolean> | undefined = undefined;
  const runtimeSampleRate = options.sampleRate;

  port.instance.onerror = () => {
    store.update((state) => {
      state.statuses.decoder = 'error';
    });
  };

  port.bindHandlers({
    booted: () => {
      bootPromise.resolve();
    },
    setState: (message) => {
      store.update((state) => {
        state.statuses.decoder = message.status;
      });
      mountPromise?.resolve();
      mountPromise = undefined;
    },
    setRealtimeState: (message) => {
      store.update((state) => {
        state.statuses.realtime = message.status;
      });
      if (message.status === 'error') {
        onRecordingStreamFailed();
      }
    },
    mounted: (message) => {
      store.update((state) => {
        state.statuses.decoder = 'success';
        state.frameCount = message.frameCount;
        state.duration = message.frameCount / runtimeSampleRate;
      });
      mountPromise?.resolve();
      mountPromise = undefined;
    },
    unmounted: () => {
      store.update((state) => {
        state.statuses.decoder = 'pending';
        state.statuses.realtime = 'pending';
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
    recordingStreamFinished: () => {
      recordingStreamPromise?.resolve();
      recordingStreamPromise = undefined;
    },
    recordingStreamFailed: (message) => {
      console.error(
        'Recording stream failed',
        sanitizeLogMessage(message.error),
      );
      recordingStreamPromise?.resolve();
      recordingStreamPromise = undefined;
      onRecordingStreamFailed();
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
      port.methods.boot({ playerPort, spectrogramPort });

      return bootPromise.promise;
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
      recordingStreamPromise = createControlledPromise<void>();
      port.methods.startRecordingStream(recording);
    },
    finishRecordingStream: async (sequence) => {
      if (!recordingStreamPromise) {
        return;
      }
      port.methods.finishRecordingStream({ sequence });
      await recordingStreamPromise.promise;
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
