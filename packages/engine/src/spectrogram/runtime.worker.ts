import {
  averageMetrics,
  createSpectrogramProcessor,
  getGpuDevice,
  type SpectrogramProcessorMetrics,
} from '@musetric/spectrogram/gpu';
import { createAnimationFrameLoop } from '@musetric/utils/cross/animationFrameLoop';
import { createThrottleTime } from '@musetric/utils/cross/throttleTime';
import { type Playhead } from '../player/playhead.cross.js';
import {
  type spectrogramChannel,
  type spectrogramDataChannel,
} from './protocol.cross.js';
import { createRecordingSource } from './recordingSource.worker.js';

export type CreateSpectrogramRuntimeOptions = {
  port: ReturnType<
    typeof spectrogramChannel.inbound<DedicatedWorkerGlobalScope>
  >;
  dataPort: ReturnType<typeof spectrogramDataChannel.inbound<MessagePort>>;
  playhead: Playhead;
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
  let lead: Float32Array | undefined = undefined;
  const recording = createRecordingSource();
  let trackProgress = 0;
  let frameCount = 0;
  let playing = false;
  let rendering = false;

  const render = async () => {
    const samples = lead ? { lead, recording: recording.get(lead.length) } : {};
    const ok = await processor.render(samples, trackProgress);
    if (!ok || !lead) {
      return;
    }
    setStatus('success');
  };

  const playheadTrackProgress = () => {
    if (frameCount <= 0) {
      return trackProgress;
    }
    const { frameIndex } = playhead.read();
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
  let renderRequest = 0;
  const fillLoop = createAnimationFrameLoop(async () => {
    if (playing) {
      return false;
    }
    const request = renderRequest;
    await renderFromPlayhead();
    return request !== renderRequest || processor.hasPendingWork();
  });

  const renderPaused = () => {
    renderRequest += 1;
    fillLoop.start();
  };

  dataPort.bindHandlers({
    mount: async (message) => {
      lead = message.lead;
      recording.clear();
      recording.setPieces(message.recording);
      await render();
    },
    unmount: async () => {
      lead = undefined;
      recording.clear();
      setStatus('pending');
      await render();
    },
    setRecordingPieces: (message) => {
      recording.setPieces(message.pieces, message.finishedTakeId);
      if (!playing) {
        renderPaused();
      }
    },
    beginLiveTake: (message) => {
      recording.beginLiveTake(message);
    },
    appendLiveTake: (message) => {
      const range = recording.appendLiveTake(
        message.frameIndex,
        message.samples,
      );
      if (!range) {
        return;
      }
      processor.invalidateSamples([{ trackKey: 'recording', ...range }]);
      if (!playing) {
        renderPaused();
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
        } else if (processor.hasPendingWork()) {
          fillLoop.start();
        }
      } catch (error) {
        console.error('Failed to render spectrogram', error);
        setStatus('error');
      }
    },
    unmount: () => {
      renderLoop.stop();
      fillLoop.stop();
      processor.dispose();
      processor = createProcessor();
      trackProgress = 0;
      frameCount = 0;
      setStatus('pending');
    },
    setTrackProgress: (message) => {
      trackProgress = message.trackProgress;
      if (frameCount > 0) {
        playhead.writeFrameIndex(
          Math.round(message.trackProgress * frameCount),
        );
      }
      if (!playing) {
        renderPaused();
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
      renderPaused();
    },
    updateConfig: (message) => {
      processor.updateConfig(message.patch);
      if (!playing) {
        renderPaused();
      }
    },
  });
};
