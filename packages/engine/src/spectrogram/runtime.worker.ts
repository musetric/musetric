import {
  averageMetrics,
  createSpectrogramProcessor,
  getGpuDevice,
  type SpectrogramProcessorMetrics,
} from '@musetric/spectrogram/gpu';
import { createAnimationFrameLoop } from '@musetric/utils/cross/animationFrameLoop';
import { createThrottleTime } from '@musetric/utils/cross/throttleTime';
import { type Playhead } from '../player/playhead.cross.js';
import { createLeadPages, type LeadPages } from './leadPages.worker.js';
import {
  type CapturedPreview,
  type ContextPreview,
} from './livePreview.cross.js';
import {
  type spectrogramChannel,
  type spectrogramDataChannel,
} from './protocol.cross.js';
import { createRecordingSource } from './recordingSource.worker.js';
import { type RenderListener } from './renderHook.worker.js';
import { createViewWindowState } from './viewWindow.worker.js';

export type CreateSpectrogramRuntimeOptions = {
  port: ReturnType<
    typeof spectrogramChannel.inbound<DedicatedWorkerGlobalScope>
  >;
  dataPort: ReturnType<typeof spectrogramDataChannel.inbound<MessagePort>>;
  playhead: Playhead;
  convertPreview: (preview: CapturedPreview) => ContextPreview | undefined;
  profiling?: boolean;
  onRendered?: RenderListener;
};

export const createSpectrogramRuntime = async (
  options: CreateSpectrogramRuntimeOptions,
) => {
  const { port, dataPort, playhead, convertPreview, profiling, onRendered } =
    options;

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
      framesInFlight: 2,
      onMetrics: profiling
        ? (metrics) => {
            metricsBuffer.push(metrics);
            logMetrics();
          }
        : undefined,
    });

  let processor = createProcessor();
  let canvas = new OffscreenCanvas(1, 1);
  let lead: LeadPages | undefined = undefined;
  const recording = createRecordingSource();
  let trackProgress = 0;
  let frameIndex = 0;
  let frameCount = 0;
  let playing = false;
  let rendering = false;
  const viewWindow = createViewWindowState();

  const render = async () => {
    const samples = lead
      ? {
          lead: lead.source,
          recording: recording.get(lead.source.length),
        }
      : {};
    const view = viewWindow.view(trackProgress * frameCount);
    if (view) {
      processor.updateConfig(view);
    }
    const liveEnd = recording.liveEnd();
    const drawn = await processor.render(
      samples,
      trackProgress,
      liveEnd === undefined ? {} : { recording: liveEnd },
    );
    if (lead) {
      lead.sweep();
      const indices = lead.takeWanted();
      if (indices.length > 0) {
        dataPort.methods.requestLeadPages({ indices });
      }
    }
    if (drawn && lead) {
      setStatus('success');
    }
    return drawn;
  };

  const present = async () => {
    const shownFrameIndex = frameIndex;
    const playheadFrame = trackProgress * frameCount;
    const startedAt = performance.timeOrigin + performance.now();
    const writtenEnd = recording.liveEnd();
    const drawn = await render();
    port.methods.presented({
      frameIndex: shownFrameIndex,
      bitmap: drawn ? canvas.transferToImageBitmap() : undefined,
    });
    if (onRendered) {
      await onRendered({
        processor,
        startedAt,
        playing,
        playheadFrame,
        writtenEnd,
      });
    }
  };

  let renderRequest = 0;
  const presentLoop = createAnimationFrameLoop(async () => {
    if (rendering) {
      return true;
    }
    rendering = true;
    const request = renderRequest;
    try {
      await present();
    } finally {
      rendering = false;
    }
    return request !== renderRequest || processor.hasPendingWork();
  });

  const requestRender = () => {
    renderRequest += 1;
    presentLoop.start();
  };

  dataPort.bindHandlers({
    mount: (message) => {
      lead = createLeadPages(message.lead);
      recording.clear();
      recording.setPieces({ pieces: message.recording });
      requestRender();
    },
    putLeadPage: (message) => {
      const range = lead?.put(message.index, message.samples);
      if (!range) {
        return;
      }
      processor.invalidateSamples([{ trackKey: 'lead', ...range }]);
      requestRender();
    },
    unmount: () => {
      lead = undefined;
      recording.clear();
      setStatus('pending');
      requestRender();
    },
    setRecordingPieces: (message) => {
      recording.setPieces(message);
      requestRender();
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
      requestRender();
    },
  });

  port.bindHandlers({
    connectPlayhead: (message) => {
      playhead.connect(message.playheadPort);
    },
    mount: (message) => {
      try {
        trackProgress = message.trackProgress;
        frameIndex = message.frameIndex;
        viewWindow.remember(message.config);
        processor.dispose();
        processor = createProcessor();
        canvas = new OffscreenCanvas(1, 1);
        processor.updateConfig({ ...message.config, canvas });
        requestRender();
      } catch (error) {
        console.error('Failed to render spectrogram', error);
        setStatus('error');
      }
    },
    unmount: () => {
      presentLoop.stop();
      processor.dispose();
      processor = createProcessor();
      trackProgress = 0;
      frameCount = 0;
      setStatus('pending');
    },
    setTrackProgress: (message) => {
      trackProgress = message.trackProgress;
      frameIndex = message.frameIndex;
      if (frameCount > 0) {
        playhead.writeFrameIndex(
          Math.round(message.trackProgress * frameCount),
          message.revision,
        );
      }
      requestRender();
    },
    setFrameCount: (message) => {
      frameCount = message.frameCount;
    },
    setPlaying: (message) => {
      playing = message.playing;
    },
    updateConfig: (message) => {
      viewWindow.remember(message.patch);
      processor.updateConfig(viewWindow.filter(message.patch));
      requestRender();
    },
    setViewWindow: (message) => {
      const restore = viewWindow.set(message.window);
      if (restore) {
        processor.updateConfig(restore);
      }
      requestRender();
    },
    previewLiveTake: (message) => {
      const preview = convertPreview(message);
      if (!preview) {
        return;
      }
      const range = recording.previewLiveTake({
        songFrame: playhead.readFrameIndexAt(preview.capturedAt),
        samples: preview.samples,
      });
      if (range) {
        processor.invalidateSamples([{ trackKey: 'recording', ...range }]);
      }
    },
  });
};
