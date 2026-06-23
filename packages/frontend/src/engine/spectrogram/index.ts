import {
  type ControlledPromise,
  createControlledPromise,
} from '@musetric/resource-utils';
import {
  getCanvasSize,
  subscribeResizeObserver,
} from '@musetric/resource-utils/dom';
import {
  spectrogramChannel,
  type SpectrogramConfig,
} from '@musetric/spectrogram';
import { type Store } from '../../common/store.js';
import { type EngineState, getTrackProgress } from '../state.js';
import spectrogramWorkerUrl from './spectrogram.worker.ts?worker&url';

type Unmount = () => void;

export type EngineSpectrogram = {
  port: ReturnType<typeof spectrogramChannel.outbound<Worker>>;
  boot: () => Promise<void>;
  mount: (
    canvas: HTMLCanvasElement,
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

  port.bindHandlers({
    booted: () => {
      bootPromise.resolve();
    },
    setState: (message) => {
      store.update((state) => {
        state.statuses.spectrogram = message.status;
      });
    },
  });

  store.subscribe(getTrackProgress, (trackProgress) => {
    port.methods.setTrackProgress({
      trackProgress,
    });
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
    mount: (canvas, config) => {
      const viewSize = getCanvasSize(canvas);
      const offscreenCanvas = canvas.transferControlToOffscreen();

      const buildLanes = (recording: boolean) => ({
        lead: {
          showSpectrogram: true,
          showFundamental: true,
          lineWidthCents: 26,
          truncateAfterPlayhead: false,
          gainDb: store.get().leadSpectrogramGainDb,
        },
        recording: {
          showSpectrogram: false,
          showFundamental: true,
          lineWidthCents: 35,
          truncateAfterPlayhead: recording,
          gainDb: 0,
        },
      });

      port.methods.mount({
        config: {
          ...config,
          canvas: offscreenCanvas,
          viewSize,
          colors: store.get().colors,
          sampleRate,
          lanes: buildLanes(store.get().recording),
          comparison: {
            reference: 'lead',
            target: 'recording',
            matchThresholdCents: 15,
            closeThresholdCents: 50,
          },
        },
        trackProgress: getTrackProgress(store.get()),
      });

      const unsubscribeResizeObserver = subscribeResizeObserver(canvas, () => {
        port.methods.updateConfig({
          patch: { viewSize: getCanvasSize(canvas) },
        });
      });

      const unsubscribeRecording = store.subscribe(
        (state) => state.recording,
        (recording) => {
          port.methods.updateConfig({
            patch: { lanes: buildLanes(recording) },
          });
        },
      );
      const unsubscribeLeadSpectrogramGain = store.subscribe(
        (state) => state.leadSpectrogramGainDb,
        () => {
          port.methods.updateConfig({
            patch: { lanes: buildLanes(store.get().recording) },
          });
        },
      );

      return () => {
        unsubscribeLeadSpectrogramGain();
        unsubscribeRecording();
        unsubscribeResizeObserver();
        port.methods.unmount();
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
