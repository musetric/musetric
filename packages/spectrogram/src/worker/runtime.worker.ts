import { createScheduler } from '@musetric/utils/cross/scheduler';
import { createThrottleTime } from '@musetric/utils/cross/throttleTime';
import { getGpuDevice } from '../common/gpuDevice.js';
import {
  averageMetrics,
  type SpectrogramProcessorMetrics,
} from '../common/processorTimer.js';
import { allTrackKeys, type TrackKey } from '../config.cross.js';
import { createSpectrogramProcessor } from '../processor.js';
import {
  type spectrogramChannel,
  type spectrogramDataChannel,
  type SpectrogramLaneSamples,
  type SpectrogramPlayhead,
} from '../protocol.cross.js';

export type CreateSpectrogramRuntimeOptions = {
  port: ReturnType<
    typeof spectrogramChannel.inbound<DedicatedWorkerGlobalScope>
  >;
  dataPort: ReturnType<typeof spectrogramDataChannel.inbound<MessagePort>>;
  playhead: SpectrogramPlayhead;
  profiling?: boolean;
};

// Slot 0 of the shared playhead holds the current frameIndex (layout owned by
// playhead.cross.ts in @musetric/audio).
const playheadFrameIndexSlot = 0;
// ~60Hz polling of the playhead while playing, matching the display refresh.
const renderLoopIntervalMs = 16;

const emptySamples = (): SpectrogramLaneSamples =>
  allTrackKeys.reduce<SpectrogramLaneSamples>((acc, key) => {
    acc[key] = undefined;
    return acc;
  }, {});

export const createSpectrogramRuntime = async (
  options: CreateSpectrogramRuntimeOptions,
) => {
  const { port, dataPort, playhead, profiling } = options;

  // The status is posted to the main thread after every render, but it almost
  // never changes between frames. Posting an identical 'success' ~60 times per
  // second was the dominant worker cost (cross-thread postMessage + main-thread
  // store churn), so only post when the status actually transitions.
  let lastStatus: 'pending' | 'error' | 'success' | undefined = undefined;
  const setStatus = (status: 'pending' | 'error' | 'success') => {
    if (status === lastStatus) {
      return;
    }
    lastStatus = status;
    port.methods.setState({ status });
  };

  const device = await getGpuDevice(profiling);

  const metricsBuffer: SpectrogramProcessorMetrics[] = [];
  const logMetrics = createThrottleTime(() => {
    console.table(averageMetrics(metricsBuffer.splice(0)));
  }, 500);

  const createProcessor = () =>
    createSpectrogramProcessor({
      device,
      onMetrics: profiling
        ? (metrics) => {
            metricsBuffer.push(metrics);
            logMetrics();
          }
        : undefined,
    });

  let processor = createProcessor();
  let samplesByLane: SpectrogramLaneSamples = emptySamples();
  let trackProgress = 0;
  let frameCount = 0;
  let playing = false;
  let rendering = false;

  const hasAnySamples = () =>
    allTrackKeys.some((key) => samplesByLane[key] !== undefined);

  const render = async (renderOptions?: {
    dirtyTracks?: readonly TrackKey[];
    contentChangedTracks?: readonly TrackKey[];
  }) => {
    if (!hasAnySamples()) {
      return;
    }

    const ok = await processor.render(samplesByLane, trackProgress, {
      dirtyTracks: renderOptions?.dirtyTracks,
      contentChangedTracks: renderOptions?.contentChangedTracks,
    });
    if (!ok) {
      return;
    }
    setStatus('success');
  };

  const presentTrackKeys = (): TrackKey[] =>
    allTrackKeys.filter((key) => samplesByLane[key] !== undefined);

  const playheadTrackProgress = () => {
    if (frameCount <= 0) {
      return trackProgress;
    }
    const frameIndex = Atomics.load(playhead, playheadFrameIndexSlot);
    return Math.min(1, Math.max(0, frameIndex / frameCount));
  };

  // While playing, the worker reads the shared playhead on its own interval and
  // re-renders, so the main thread no longer pushes setTrackProgress per frame.
  const renderFromPlayhead = async () => {
    if (rendering) {
      return;
    }
    rendering = true;
    try {
      trackProgress = playheadTrackProgress();
      await render();
    } finally {
      rendering = false;
    }
  };

  const renderLoop = createScheduler(renderFromPlayhead, renderLoopIntervalMs);

  dataPort.bindHandlers({
    mount: async (message) => {
      samplesByLane = { ...emptySamples(), ...message.samples };
      await render({ contentChangedTracks: presentTrackKeys() });
    },
    unmount: () => {
      samplesByLane = emptySamples();
      setStatus('pending');
    },
    samplesChanged: (message) => {
      void render({
        dirtyTracks: [message.trackKey],
        contentChangedTracks: [message.trackKey],
      });
    },
  });

  port.bindHandlers({
    mount: async (message) => {
      try {
        trackProgress = message.trackProgress;
        processor.dispose();
        processor = createProcessor();
        processor.updateConfig(message.config);
        await render();
        if (playing) {
          renderLoop.start();
        }
      } catch (error) {
        console.error('Failed to render spectrogram', error);
        setStatus('error');
      }
    },
    unmount: () => {
      renderLoop.stop();
      processor.dispose();
      processor = createProcessor();
      trackProgress = 0;
      frameCount = 0;
      setStatus('pending');
    },
    setTrackProgress: (message) => {
      trackProgress = message.trackProgress;
      void render();
    },
    setFrameCount: (message) => {
      frameCount = message.frameCount;
    },
    setPlaying: (message) => {
      playing = message.playing;
      if (playing) {
        renderLoop.start();
      } else {
        renderLoop.stop();
      }
    },
    updateConfig: (message) => {
      processor.updateConfig(message.patch);
      void render();
    },
  });
};
