import {
  defaultSpectrogramConfig,
  type SpectrogramConfig,
} from '@musetric/spectrogram';
import {
  type ControlledPromise,
  createControlledPromise,
} from '@musetric/utils';
import { getCanvasSize, subscribeResizeObserver } from '@musetric/utils/dom';
import { type CapturedChunk } from '../audioSession/timedChunkPusher.cross.js';
import { type Store } from '../common/store.js';
import {
  type EngineState,
  getFrequencyRange,
  getNoteShiftSemitones,
  getTrackProgress,
} from '../state.js';
import { toContextRate } from './livePreview.cross.js';
import { spectrogramChannel } from './protocol.cross.js';
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
  previewLiveTake: (chunk: CapturedChunk) => void;
};

export type CreateEngineSpectrogramOptions = {
  store: Store<EngineState>;
  sampleRate: number;
  decoderPort: MessagePort;
  playheadPort: MessagePort;
};

export const createEngineSpectrogram = (
  options: CreateEngineSpectrogramOptions,
): EngineSpectrogram => {
  const { store, sampleRate, decoderPort, playheadPort } = options;
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
    setVocalLesson: (message) => {
      store.update((state) => {
        state.vocalLessonStatus = message.status;
        state.vocalLessonPhrases = message.phrases ?? state.vocalLessonPhrases;
      });
    },
  });

  store.subscribe(getTrackProgress, (trackProgress) => {
    const spectrogramWorkerPollsPlayheadWhilePlaying = store.get().playing;
    if (spectrogramWorkerPollsPlayheadWhilePlaying) {
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
    (state) => state.viewWindow,
    (window) => {
      port.methods.setViewWindow({ window });
    },
  );

  store.subscribe(
    (state) => state.frameCount,
    (frameCount) => {
      port.methods.setFrameCount({ frameCount: frameCount ?? 0 });
    },
  );

  store.subscribe(
    (state) => state.vocalLessonEnabled,
    (enabled) => {
      port.methods.setVocalLesson({ enabled });
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
        playheadPort,
        sampleRate,
      });

      await bootPromise.promise;
      port.methods.setFrameCount({ frameCount: store.get().frameCount ?? 0 });
      port.methods.setVocalLesson({ enabled: store.get().vocalLessonEnabled });
    },
    mount: (canvas, config) => {
      const viewSize = getCanvasSize(canvas);
      const offscreenCanvas = canvas.transferControlToOffscreen();
      const engineState = store.get();

      const buildLanes = (state: EngineState) => {
        const notes = state.spectrogramView === 'notes';
        return {
          lead: {
            ...defaultSpectrogramConfig.lanes.lead,
            showSpectrogram: !notes,
            showFundamental: notes,
            showNotes: notes,
            gainDb: state.leadSpectrogramGainDb,
            transposeSemitones: getNoteShiftSemitones(state),
          },
          recording: {
            ...defaultSpectrogramConfig.lanes.recording,
            showSpectrogram: !notes,
            showFundamental: true,
            showNotes: notes,
            truncateAfterPlayhead: state.recording,
            transposeSemitones: getNoteShiftSemitones(state),
          },
        };
      };
      const buildStateView = (state: EngineState) => ({
        ...getFrequencyRange(state),
        lanes: buildLanes(state),
      });

      port.methods.setFrameCount({ frameCount: engineState.frameCount ?? 0 });
      port.methods.mount({
        config: {
          ...defaultSpectrogramConfig,
          ...config,
          canvas: offscreenCanvas,
          viewSize,
          colors: engineState.colors,
          sampleRate,
          ...buildStateView(engineState),
        },
        trackProgress: getTrackProgress(engineState),
      });
      port.methods.setPlaying({ playing: engineState.playing });

      const unsubscribeResizeObserver = subscribeResizeObserver(canvas, () => {
        port.methods.updateConfig({
          patch: { viewSize: getCanvasSize(canvas) },
        });
      });

      const unsubscribeView = store.subscribe(
        (state) => {
          const range = getFrequencyRange(state);
          return `${state.spectrogramView}:${state.recording}:${state.leadSpectrogramGainDb}:${state.transposeSemitones}:${state.voiceOctave}:${range.minFrequency}:${range.maxFrequency}`;
        },
        () => {
          port.methods.updateConfig({
            patch: buildStateView(store.get()),
          });
        },
      );

      return () => {
        unsubscribeView();
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
    previewLiveTake: (chunk) => {
      if (!store.get().recording) {
        return;
      }
      port.methods.previewLiveTake({
        capturedAt: performance.timeOrigin + chunk.startMs,
        samples: toContextRate(chunk.samples, chunk.sampleRate, sampleRate),
      });
    },
  };
};
