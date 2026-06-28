import { allTrackKeys } from '@musetric/spectrogram';
import {
  averageMetrics,
  createSpectrogramProcessor,
  getGpuDevice,
  type SpectrogramProcessorMetrics,
  type SpectrogramSampleInvalidation,
} from '@musetric/spectrogram/gpu';
import { createAnimationFrameLoop } from '@musetric/utils/cross/animationFrameLoop';
import { createThrottleTime } from '@musetric/utils/cross/throttleTime';
import {
  type spectrogramChannel,
  type spectrogramDataChannel,
  type SpectrogramLaneSamples,
  type SpectrogramPlayhead,
} from './protocol.cross.js';

export type CreateSpectrogramRuntimeOptions = {
  port: ReturnType<
    typeof spectrogramChannel.inbound<DedicatedWorkerGlobalScope>
  >;
  dataPort: ReturnType<typeof spectrogramDataChannel.inbound<MessagePort>>;
  playhead: SpectrogramPlayhead;
  profiling?: boolean;
};

const playheadFrameIndexSlot = 0;

const emptySamples = (): SpectrogramLaneSamples =>
  allTrackKeys.reduce<SpectrogramLaneSamples>((acc, key) => {
    acc[key] = undefined;
    return acc;
  }, {});

const playheadAdvanceInvalidations: readonly SpectrogramSampleInvalidation[] =
  allTrackKeys.map((trackKey) => ({
    trackKey,
    frameIndex: 0,
    frameCount: 0,
  }));

export const createSpectrogramRuntime = async (
  options: CreateSpectrogramRuntimeOptions,
) => {
  const { port, dataPort, playhead, profiling } = options;

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

  const render = async () => {
    if (!hasAnySamples()) {
      return;
    }
    const ok = await processor.render(samplesByLane, trackProgress);
    if (!ok) {
      return;
    }
    setStatus('success');
  };

  const playheadTrackProgress = () => {
    if (frameCount <= 0) {
      return trackProgress;
    }
    const frameIndex = Atomics.load(playhead, playheadFrameIndexSlot);
    return Math.min(1, Math.max(0, frameIndex / frameCount));
  };

  const renderFromPlayhead = async () => {
    if (rendering) {
      return;
    }
    rendering = true;
    try {
      trackProgress = playheadTrackProgress();
      processor.invalidateSamples(playheadAdvanceInvalidations);
      await render();
    } finally {
      rendering = false;
    }
  };

  const renderLoop = createAnimationFrameLoop(renderFromPlayhead);

  dataPort.bindHandlers({
    mount: async (message) => {
      samplesByLane = { ...emptySamples(), ...message.samples };
      await render();
    },
    unmount: () => {
      samplesByLane = emptySamples();
      setStatus('pending');
    },
    samplesChanged: (message) => {
      processor.invalidateSamples([
        {
          trackKey: message.trackKey,
          frameIndex: message.frameIndex,
          frameCount: message.frameCount,
        },
      ]);
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
        void render();
      }
    },
    updateConfig: (message) => {
      processor.updateConfig(message.patch);
      void render();
    },
  });
};
