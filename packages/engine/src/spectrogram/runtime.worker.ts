import { allTrackKeys, mapTrackKeys } from '@musetric/spectrogram';
import {
  averageMetrics,
  createSpectrogramProcessor,
  getGpuDevice,
  type SpectrogramProcessorMetrics,
} from '@musetric/spectrogram/gpu';
import { createAnimationFrameLoop } from '@musetric/utils/cross/animationFrameLoop';
import { createThrottleTime } from '@musetric/utils/cross/throttleTime';
import {
  type spectrogramChannel,
  type spectrogramDataChannel,
  type SpectrogramLaneSamples,
  type SpectrogramPlayhead,
} from './protocol.cross.js';

const playheadFrameIndexSlot = 0;

const emptySamples = (): SpectrogramLaneSamples =>
  mapTrackKeys(() => undefined);

export type CreateSpectrogramRuntimeOptions = {
  port: ReturnType<
    typeof spectrogramChannel.inbound<DedicatedWorkerGlobalScope>
  >;
  dataPort: ReturnType<typeof spectrogramDataChannel.inbound<MessagePort>>;
  playhead: SpectrogramPlayhead;
  profiling?: boolean;
};

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
      if (!playing) {
        void renderFromPlayhead();
      }
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
      if (frameCount > 0) {
        const frameIndex = Math.round(message.trackProgress * frameCount);
        Atomics.store(playhead, playheadFrameIndexSlot, frameIndex);
      }
      if (!playing) {
        void renderFromPlayhead();
      }
    },
    setFrameCount: (message) => {
      frameCount = message.frameCount;
    },
    setPlaying: (message) => {
      playing = message.playing;
      if (playing) {
        renderLoop.start();
        return;
      }
      renderLoop.stop();
      void renderFromPlayhead();
    },
    updateConfig: (message) => {
      processor.updateConfig(message.patch);
      if (!playing) {
        void renderFromPlayhead();
      }
    },
  });
};
