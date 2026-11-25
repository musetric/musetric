import {
  defaultSpectrogramConfig,
  type SpectrogramConfig,
} from '@musetric/spectrogram';
import {
  assertDefined,
  type ControlledPromise,
  createControlledPromise,
} from '@musetric/utils';
import { getCanvasSize, subscribeResizeObserver } from '@musetric/utils/dom';
import { compileCapture } from '../audioSession/captureModule.js';
import { type CapturedChunk } from '../audioSession/timedChunkPusher.cross.js';
import { type Store } from '../common/store.js';
import { type EnginePositionWriter } from '../player/position.js';
import {
  type EngineState,
  getFrequencyRange,
  getNoteShiftSemitones,
  getTrackProgress,
  isPlaying,
  isRecording,
} from '../state.js';
import { spectrogramChannel } from './protocol.cross.js';
import spectrogramWorkerUrl from './spectrogram.worker.ts?worker&url';

type Unmount = () => void;

export type EngineSpectrogram = {
  port: ReturnType<typeof spectrogramChannel.outbound<Worker>>;
  boot: () => Promise<void>;
  connectPlayhead: (playheadPort: MessagePort) => void;
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
  position: EnginePositionWriter;
};

export const createEngineSpectrogram = (
  options: CreateEngineSpectrogramOptions,
): EngineSpectrogram => {
  const { store, sampleRate, decoderPort, position } = options;
  const worker = new Worker(spectrogramWorkerUrl, { type: 'module' });
  const port = spectrogramChannel.outbound(worker);
  const bootPromise: ControlledPromise<void> = createControlledPromise<void>();
  let bitmaps: ImageBitmapRenderingContext | undefined = undefined;
  let requested = position.read();

  const presenter = () =>
    store.get().statuses.spectrogram === 'error' ? undefined : bitmaps;
  const fail = () => {
    store.update((state) => {
      state.statuses.spectrogram = 'error';
    });
    position.show(requested);
  };
  port.instance.onerror = fail;

  port.bindHandlers({
    booted: () => {
      bootPromise.resolve();
    },
    setState: (message) => {
      if (message.status === 'error') {
        fail();
        return;
      }
      store.update((state) => {
        state.statuses.spectrogram = message.status;
      });
    },
    presented: (message) => {
      const context = presenter();
      if (!context) {
        message.bitmap?.close();
        return;
      }
      if (message.bitmap) {
        context.transferFromImageBitmap(message.bitmap);
      }
      position.show(message.frameIndex);
    },
  });

  const sendTrackProgress = () => {
    const state = store.get();
    port.methods.setTrackProgress({
      trackProgress: getTrackProgress(requested, state.frameCount),
      frameIndex: requested,
      revision: state.seekEvent.revision,
    });
  };
  position.setStage((frameIndex) => {
    requested = frameIndex;
    if (presenter()) {
      sendTrackProgress();
      return;
    }
    position.show(frameIndex);
  });
  store.subscribe((state) => state.frameCount, sendTrackProgress);
  store.subscribe((state) => state.seekEvent.revision, sendTrackProgress);

  store.subscribe(isPlaying, (playing) => {
    port.methods.setPlaying({ playing });
  });

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
        sampleRate,
        captureModule: await compileCapture(),
      });

      await bootPromise.promise;
      port.methods.setFrameCount({ frameCount: store.get().frameCount ?? 0 });
    },
    connectPlayhead: (playheadPort) => {
      void bootPromise.promise.then(() => {
        port.methods.connectPlayhead({ playheadPort });
      });
    },
    mount: (canvas, config) => {
      const viewSize = getCanvasSize(canvas);
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
            truncateAfterPlayhead: isRecording(state),
            transposeSemitones: getNoteShiftSemitones(state),
          },
        };
      };
      const buildStateView = (state: EngineState) => ({
        ...getFrequencyRange(state),
        lanes: buildLanes(state),
        expandedLane: state.expandedSpectrumLane,
      });

      port.methods.setFrameCount({ frameCount: engineState.frameCount ?? 0 });
      port.methods.mount({
        config: {
          ...defaultSpectrogramConfig,
          ...config,
          viewSize,
          colors: engineState.colors,
          sampleRate,
          ...buildStateView(engineState),
        },
        trackProgress: getTrackProgress(requested, engineState.frameCount),
        frameIndex: requested,
      });
      bitmaps = assertDefined(
        canvas.getContext('bitmaprenderer'),
        'The spectrogram canvas has no bitmap renderer',
      );
      port.methods.setPlaying({ playing: isPlaying(engineState) });

      const unsubscribeResizeObserver = subscribeResizeObserver(canvas, () => {
        port.methods.updateConfig({
          patch: { viewSize: getCanvasSize(canvas) },
        });
      });

      const unsubscribeView = store.subscribe(
        (state) => {
          const range = getFrequencyRange(state);
          return `${state.spectrogramView}:${state.expandedSpectrumLane}:${isRecording(state)}:${state.leadSpectrogramGainDb}:${state.transposeSemitones}:${state.voiceOctave}:${range.minFrequency}:${range.maxFrequency}`;
        },
        () => {
          port.methods.updateConfig({
            patch: buildStateView(store.get()),
          });
        },
      );

      return () => {
        bitmaps = undefined;
        position.show(requested);
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
      if (!isRecording(store.get())) {
        return;
      }
      port.methods.previewLiveTake({
        capturedAt: performance.timeOrigin + chunk.startMs,
        sampleRate: chunk.sampleRate,
        samples: chunk.samples.slice(),
      });
    },
  };
};
