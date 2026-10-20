import {
  averageMetrics,
  createSpectrogramProcessor,
  getGpuDevice,
  type SpectrogramProcessorMetrics,
} from '@musetric/spectrogram/gpu';
import { createAnimationFrameLoop } from '@musetric/utils/cross/animationFrameLoop';
import { createThrottleTime } from '@musetric/utils/cross/throttleTime';
import { type Playhead } from '../player/playhead.cross.js';
import { createEdgeProbe } from './edgeProbe.worker.js';
import {
  type spectrogramChannel,
  type spectrogramDataChannel,
} from './protocol.cross.js';
import { createRecordingSource } from './recordingSource.worker.js';
import { createViewWindowState } from './viewWindow.worker.js';

export type CreateSpectrogramRuntimeOptions = {
  port: ReturnType<
    typeof spectrogramChannel.inbound<DedicatedWorkerGlobalScope>
  >;
  dataPort: ReturnType<typeof spectrogramDataChannel.inbound<MessagePort>>;
  playhead: Playhead;
  sampleRate: number;
  profiling?: boolean;
  measure?: boolean;
};

export const createSpectrogramRuntime = async (
  options: CreateSpectrogramRuntimeOptions,
) => {
  const { port, dataPort, playhead, sampleRate, profiling, measure } = options;

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
  const viewWindow = createViewWindowState();
  const probeEdges = measure ? createEdgeProbe(sampleRate) : undefined;

  const render = async () => {
    const samples = lead ? { lead, recording: recording.get(lead.length) } : {};
    const view = viewWindow.view(trackProgress * frameCount);
    if (view) {
      processor.updateConfig(view);
    }
    const liveEnd = recording.liveEnd();
    const ok = await processor.render(
      samples,
      trackProgress,
      liveEnd === undefined ? {} : { recording: liveEnd },
    );
    if (!ok || !lead) {
      return;
    }
    setStatus('success');
  };

  const playheadTrackProgress = () => {
    if (frameCount <= 0) {
      return trackProgress;
    }
    return Math.min(1, Math.max(0, playhead.readFrameIndex() / frameCount));
  };

  const renderFromPlayhead = async () => {
    if (rendering) {
      return;
    }
    rendering = true;
    try {
      trackProgress = playheadTrackProgress();
      const startedAt = performance.timeOrigin + performance.now();
      const writtenEnd = recording.liveEnd();
      await render();
      if (probeEdges && playing && writtenEnd !== undefined) {
        await probeEdges(processor, {
          startedAt,
          playheadFrame: trackProgress * frameCount,
          writtenEnd,
        });
      }
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
      recording.setPieces({ pieces: message.recording });
      await render();
    },
    unmount: async () => {
      lead = undefined;
      recording.clear();
      setStatus('pending');
      await render();
    },
    setRecordingPieces: (message) => {
      recording.setPieces(message);
      if (!playing) {
        renderPaused();
      }
    },
    beginLiveTake: (message) => {
      recording.beginLiveTake(message);
    },
    appendLiveTake: (message) => {
      const range = recording.appendLiveTake(message);
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
        viewWindow.remember(message.config);
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
      viewWindow.remember(message.patch);
      processor.updateConfig(viewWindow.filter(message.patch));
      if (!playing) {
        renderPaused();
      }
    },
    setViewWindow: (message) => {
      const restore = viewWindow.set(message.window);
      if (restore) {
        processor.updateConfig(restore);
      }
      if (!playing) {
        renderPaused();
      }
    },
    previewLiveTake: (message) => {
      const range = recording.previewLiveTake({
        songFrame: playhead.readFrameIndexAt(message.capturedAt),
        samples: message.samples,
      });
      if (range) {
        processor.invalidateSamples([{ trackKey: 'recording', ...range }]);
      }
    },
  });
};
