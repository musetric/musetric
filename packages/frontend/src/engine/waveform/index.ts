import { type StemType, waveformChannel } from '@musetric/audio';
import {
  type ControlledPromise,
  createControlledPromise,
} from '@musetric/resource-utils';
import {
  getCanvasSize,
  resizeCanvas,
  subscribeResizeObserver,
} from '@musetric/resource-utils/dom';
import type { Store } from '../../common/store.js';
import { type EngineState } from '../state.js';
import waveformWorkerUrl from './waveform.worker.ts?worker&url';

type Unmount = () => void;

export type EngineWaveform = {
  port: ReturnType<typeof waveformChannel.outbound<Worker>>;
  boot: () => Promise<void>;
  mountDelivery: (options: {
    projectId: number;
    stemType: StemType;
    canvas: HTMLCanvasElement;
  }) => Unmount;
  mountRecording: (options: {
    projectId: number;
    canvas: HTMLCanvasElement;
  }) => Unmount;
  refreshDelivery: (stemType: StemType) => void;
  refreshRecording: () => void;
  applyRecordingPeakPatch: (message: {
    startPeakIndex: number;
    peaks: Float32Array<ArrayBuffer>;
  }) => void;
};

export const createEngineWaveform = (
  store: Store<EngineState>,
): EngineWaveform => {
  const worker = new Worker(waveformWorkerUrl, { type: 'module' });
  const port = waveformChannel.outbound(worker);
  const bootPromise: ControlledPromise<void> = createControlledPromise<void>();

  port.instance.onerror = () => {
    store.update((state) => {
      state.statuses.waveform = {
        lead: 'error',
        backing: 'error',
        instrumental: 'error',
        recording: 'error',
      };
    });
  };

  port.bindHandlers({
    booted: () => {
      bootPromise.resolve();
    },
    setDeliveryState: (message) => {
      store.update((state) => {
        state.statuses.waveform[message.stemType] = message.status;
      });
    },
    setRecordingState: (message) => {
      store.update((state) => {
        state.statuses.waveform.recording = message.status;
      });
    },
  });

  store.subscribe(
    (state) => state.colors,
    (colors) => {
      port.methods.setColors({
        colors,
      });
    },
  );

  return {
    port,
    boot: async () => {
      port.methods.boot();

      return bootPromise.promise;
    },
    mountDelivery: (options) => {
      const { projectId, stemType, canvas } = options;

      resizeCanvas(canvas);
      const viewSize = getCanvasSize(canvas);
      const offscreenCanvas = canvas.transferControlToOffscreen();

      port.methods.mountDelivery({
        projectId,
        stemType,
        canvas: offscreenCanvas,
        colors: store.get().colors,
        viewSize,
        frameCount: store.get().frameCount ?? 0,
      });

      const unsubscribeResizeObserver = subscribeResizeObserver(canvas, () => {
        port.methods.resizeDelivery({
          stemType,
          viewSize: getCanvasSize(canvas),
        });
      });

      return () => {
        unsubscribeResizeObserver();
        port.methods.unmountDelivery({
          stemType,
        });
        store.update((state) => {
          state.statuses.waveform[stemType] = 'pending';
        });
      };
    },
    mountRecording: (options) => {
      const { projectId, canvas } = options;

      resizeCanvas(canvas);
      const viewSize = getCanvasSize(canvas);
      const offscreenCanvas = canvas.transferControlToOffscreen();

      port.methods.mountRecording({
        projectId,
        canvas: offscreenCanvas,
        colors: store.get().colors,
        viewSize,
        frameCount: store.get().frameCount ?? 0,
      });

      const unsubscribeResizeObserver = subscribeResizeObserver(canvas, () => {
        port.methods.resizeRecording({
          viewSize: getCanvasSize(canvas),
        });
      });

      return () => {
        unsubscribeResizeObserver();
        port.methods.unmountRecording();
        store.update((state) => {
          state.statuses.waveform.recording = 'pending';
        });
      };
    },
    refreshDelivery: (stemType) => {
      port.methods.refreshDelivery({ stemType });
    },
    refreshRecording: () => {
      port.methods.refreshRecording();
    },
    applyRecordingPeakPatch: (message) => {
      port.methods.applyRecordingPeakPatch(message);
    },
  };
};
