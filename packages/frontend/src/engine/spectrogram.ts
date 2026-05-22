import { spectrogramChannel, type SpectrogramConfig } from '@musetric/audio';
import {
  type ControlledPromise,
  createControlledPromise,
} from '@musetric/resource-utils';
import {
  createCanvasCache,
  defaultCacheConfig,
  getCanvasSize,
  subscribeResizeObserver,
} from '@musetric/resource-utils/dom';
import type { Store } from '../common/store.js';
import spectrogramWorkerUrl from './spectrogram.worker.ts?worker&url';
import { type EngineState, getTrackProgress } from './state.js';

type Unmount = () => void;

export type EngineSpectrogram = {
  port: ReturnType<typeof spectrogramChannel.outbound<Worker>>;
  boot: () => Promise<void>;
  mount: (
    container: HTMLElement,
    config: Partial<SpectrogramConfig>,
  ) => Unmount;
  setConfig: (patch: Partial<SpectrogramConfig>) => void;
};

export type CreateEngineSpectrogramOptions = {
  store: Store<EngineState>;
  sampleRate: number;
  decoderPort: MessagePort;
};

export const createEngineSpectrogram = (
  options: CreateEngineSpectrogramOptions,
): EngineSpectrogram => {
  const { store, sampleRate, decoderPort } = options;
  const worker = new Worker(spectrogramWorkerUrl, { type: 'module' });
  const port = spectrogramChannel.outbound(worker);
  const bootPromise: ControlledPromise<void> = createControlledPromise<void>();
  port.instance.onerror = () => {
    store.update((state) => {
      state.statuses.spectrogram = 'error';
    });
  };

  const cache = createCanvasCache(defaultCacheConfig);
  let lastRenderedProgress = -1;

  port.bindHandlers({
    booted: () => {
      bootPromise.resolve();
    },
    setState: (message) => {
      store.update((state) => {
        state.statuses.spectrogram = message.status;
      });

      if (message.status === 'success' && lastRenderedProgress >= 0) {
        cache.updateCache(lastRenderedProgress);
      }
    },
  });

  let containerRef: HTMLElement | undefined = undefined;
  let canvasRef: HTMLCanvasElement | undefined = undefined;

  store.subscribe(getTrackProgress, (trackProgress) => {
    if (!containerRef || !canvasRef) return;

    if (cache.shouldRender(trackProgress)) {
      lastRenderedProgress = trackProgress;
      port.methods.setTrackProgress({
        trackProgress,
      });
    }

    cache.updateTransform(trackProgress, containerRef, canvasRef);
  });

  store.subscribe(
    (state) => state.colors,
    (colors) => {
      port.methods.updateConfig({
        patch: { colors },
      });
    },
  );

  return {
    port,
    boot: async () => {
      port.methods.boot({
        dataPort: decoderPort,
      });

      return bootPromise.promise;
    },
    mount: (container, config) => {
      containerRef = container;
      const canvas = container.querySelector('canvas');
      if (!canvas) {
        return () => {
          containerRef = undefined;
        };
      }
      canvasRef = canvas;

      const viewSize = getCanvasSize(canvas);
      const offscreenCanvas = canvas.transferControlToOffscreen();

      port.methods.mount({
        config: {
          ...config,
          canvas: offscreenCanvas,
          viewSize,
          colors: store.get().colors,
          sampleRate,
          paddingLeftFactor: defaultCacheConfig.paddingLeftFactor,
          paddingRightFactor: defaultCacheConfig.paddingRightFactor,
        },
        trackProgress: getTrackProgress(store.get()),
      });

      lastRenderedProgress = getTrackProgress(store.get());

      const unsubscribeResizeObserver = subscribeResizeObserver(
        container,
        () => {
          cache.invalidate();
          port.methods.updateConfig({
            patch: { viewSize: getCanvasSize(canvas) },
          });
        },
      );

      return () => {
        unsubscribeResizeObserver();
        port.methods.unmount();
        cache.invalidate();
        containerRef = undefined;
        canvasRef = undefined;
        store.update((state) => {
          state.statuses.spectrogram = 'pending';
        });
      };
    },
    setConfig: (patch) => {
      port.methods.updateConfig({
        patch,
      });
    },
  };
};
