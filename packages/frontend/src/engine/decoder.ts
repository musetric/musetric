import {
  type ControlledPromise,
  createControlledPromise,
} from '@musetric/resource-utils';
import type { Store } from '../common/store.js';
import decoderWorkerUrl from './decoder.worker.ts?worker&url';
import { engineDecoderChannel } from './decoderProtocol.js';
import type { EngineState } from './state.js';

type Unmount = () => void;

export type EngineDecoder = {
  port: ReturnType<typeof engineDecoderChannel.outbound<Worker>>;
  boot: () => Promise<void>;
  mount: (projectId: number) => Unmount;
  startRecordingStream: (options: {
    projectId: number;
    sampleRate: number;
    frameCount: number;
    latencyFrameCount: number;
    samples: Float32Array<SharedArrayBuffer>;
    metadata: Int32Array<SharedArrayBuffer>;
    port: MessagePort;
  }) => void;
  finishRecordingStream: (sequence: number) => Promise<void>;
  sendPlayerPlay: () => void;
  sendPlayerRecord: () => void;
  sendPlayerStop: () => void;
  sendPlayerFrameIndex: (message: {
    frameIndex: number;
    frozen: boolean;
    revision: number;
    source: 'playback' | 'user';
  }) => void;
  sendPlayerSyncRequest: () => void;
};

export type CreateEngineDecoderOptions = {
  store: Store<EngineState>;
  sampleRate: number;
  playerPort: MessagePort;
  spectrogramPort: MessagePort;
  onRecordingPeaksChanged: (message: {
    startPeakIndex: number;
    peaks: Float32Array<ArrayBuffer>;
  }) => void;
  onRecordingStreamFailed: () => void;
  onPlayerPlayRequested: () => void;
  onPlayerRecordRequested: () => void;
  onPlayerStopRequested: () => void;
  onPlayerFrameIndexChanged: (
    frameIndex: number,
    frozen: boolean,
    revision: number,
    source: 'playback' | 'user',
  ) => void;
  onPlayerRevisionChanged: (revision: number) => void;
  onPlayerSyncState: (state: {
    isSlave: boolean;
    playing: boolean;
    recording: boolean;
    frozen: boolean;
    frameIndex: number;
    revision: number;
  }) => void;
};

const sanitizeLogMessage = (message: string) =>
  message.replace(/[\r\n\u2028\u2029]/g, ' ');

export const createEngineDecoder = (
  options: CreateEngineDecoderOptions,
): EngineDecoder => {
  const {
    store,
    playerPort,
    spectrogramPort,
    onRecordingPeaksChanged,
    onRecordingStreamFailed,
    onPlayerPlayRequested,
    onPlayerRecordRequested,
    onPlayerStopRequested,
    onPlayerFrameIndexChanged,
    onPlayerRevisionChanged,
    onPlayerSyncState,
  } = options;
  const worker = new Worker(decoderWorkerUrl, { type: 'module' });
  const port = engineDecoderChannel.outbound(worker);
  const bootPromise: ControlledPromise<void> = createControlledPromise<void>();
  let mountPromise: ControlledPromise<void> | undefined = undefined;
  let recordingStreamPromise: ControlledPromise<void> | undefined = undefined;
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
    playerPlayRequested: onPlayerPlayRequested,
    playerRecordRequested: onPlayerRecordRequested,
    playerStopRequested: onPlayerStopRequested,
    playerFrameIndexChanged: (message) => {
      onPlayerFrameIndexChanged(
        message.frameIndex,
        message.frozen,
        message.revision,
        message.source,
      );
    },
    playerRevisionChanged: (message) => {
      onPlayerRevisionChanged(message.revision);
    },
    playerSyncState: onPlayerSyncState,
  });

  return {
    port,
    boot: async () => {
      port.methods.boot({
        playerPort,
        spectrogramPort,
      });

      return bootPromise.promise;
    },
    mount: (projectId) => {
      mountPromise = createControlledPromise<void>();
      port.methods.mount({
        projectId,
        sampleRate: runtimeSampleRate,
      });

      return () => {
        port.methods.unmount();
      };
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
    sendPlayerPlay: () => {
      port.methods.sendPlayerPlay();
    },
    sendPlayerRecord: () => {
      port.methods.sendPlayerRecord();
    },
    sendPlayerStop: () => {
      port.methods.sendPlayerStop();
    },
    sendPlayerFrameIndex: (message) => {
      port.methods.sendPlayerFrameIndex(message);
    },
    sendPlayerSyncRequest: () => {
      port.methods.sendPlayerSyncRequest();
    },
  };
};
