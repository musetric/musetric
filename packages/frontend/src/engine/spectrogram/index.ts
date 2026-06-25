import { type Playhead } from '@musetric/audio';
import {
  defaultSpectrogramConfig,
  spectrogramChannel,
  type SpectrogramConfig,
} from '@musetric/spectrogram';
import {
  type ControlledPromise,
  createControlledPromise,
} from '@musetric/utils';
import { getCanvasSize, subscribeResizeObserver } from '@musetric/utils/dom';
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
  playhead: Playhead;
};

export const createEngineSpectrogram = (
  options: CreateEngineSpectrogramOptions,
): EngineSpectrogram => {
  const { store, sampleRate, decoderPort, playhead } = options;
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

  // While playing, the spectrogram worker polls the shared playhead itself, so
  // only push discrete progress changes (e.g. seeks while paused) from here.
  store.subscribe(getTrackProgress, (trackProgress) => {
    if (store.get().playing) {
      return;
    }
    port.methods.setTrackProgress({
      trackProgress,
    });
  });

  store.subscribe(
    (state) => state.playing,
    (playing) => {
      port.methods.setPlaying({ playing });
    },
  );

  store.subscribe(
    (state) => state.frameCount,
    (frameCount) => {
      port.methods.setFrameCount({ frameCount: frameCount ?? 0 });
    },
  );

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
        playhead,
      });

      await bootPromise.promise;
      port.methods.setFrameCount({ frameCount: store.get().frameCount ?? 0 });
    },
    mount: (canvas, config) => {
      const viewSize = getCanvasSize(canvas);
      const offscreenCanvas = canvas.transferControlToOffscreen();

      const buildLanes = (recording: boolean) => ({
        lead: {
          ...defaultSpectrogramConfig.lanes.lead,
          gainDb: store.get().leadSpectrogramGainDb,
        },
        recording: {
          ...defaultSpectrogramConfig.lanes.recording,
          truncateAfterPlayhead: recording,
        },
      });

      port.methods.mount({
        config: {
          ...defaultSpectrogramConfig,
          ...config,
          canvas: offscreenCanvas,
          viewSize,
          colors: store.get().colors,
          sampleRate,
          lanes: buildLanes(store.get().recording),
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
