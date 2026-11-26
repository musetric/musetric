import {
  type SpectrogramProcessor,
  type SpectrogramProcessorMetrics,
} from '@musetric/spectrogram/gpu';
import { defaultSampleRate } from '@musetric/utils';
import { findDrawnEdges } from '../analysis/edges.js';

const probeEvery = 3;
const energyFrequency = 1000;

type RenderedFrame = {
  processor: SpectrogramProcessor;
  device: GPUDevice;
  metrics: SpectrogramProcessorMetrics | undefined;
  startedAt: number;
  playing: boolean;
  playheadFrame: number;
  writtenEnd: number | undefined;
};

type WorkerHooks = {
  setRenderListener: (
    listener: ((frame: RenderedFrame) => Promise<void>) | undefined,
  ) => void;
};

declare const musetricMeasureHooks: WorkerHooks | undefined;

type LiveFrame = RenderedFrame & { writtenEnd: number };

const createEdgeProbe = (sampleRate: number) => {
  let renderCount = 0;
  return async (frame: LiveFrame) => {
    renderCount += 1;
    if (renderCount % probeEvery !== 0) {
      return;
    }
    const renderedAt = performance.timeOrigin + performance.now();
    const line = await frame.processor.readFundamentalLine('recording');
    if (!line) {
      return;
    }
    const energy = await frame.processor.readColumnEnergy(
      'recording',
      energyFrequency,
    );
    const edges = findDrawnEdges(line, energy, frame.playheadFrame, sampleRate);
    console.info(
      '[measure]',
      'edge',
      frame.startedAt,
      frame.playheadFrame,
      renderedAt,
      edges.pitchEdge,
      edges.energyEdge,
      frame.writtenEnd,
      edges.level,
    );
  };
};

if (typeof musetricMeasureHooks === 'undefined') {
  throw new Error('The spectrogram worker has no measure hooks');
}
const probeEdges = createEdgeProbe(defaultSampleRate);
musetricMeasureHooks.setRenderListener(async (frame) => {
  console.info(
    '[measure]',
    'drawn',
    frame.startedAt,
    frame.playheadFrame,
    frame.playing ? 1 : 0,
  );
  const submittedAt = performance.timeOrigin + performance.now();
  void frame.device.queue.onSubmittedWorkDone().then(() => {
    console.info(
      '[measure]',
      'frame',
      frame.startedAt,
      submittedAt,
      performance.timeOrigin + performance.now(),
      frame.playing ? 1 : 0,
      frame.playheadFrame,
      JSON.stringify(frame.metrics ?? {}),
    );
  });
  const { writtenEnd } = frame;
  if (frame.playing && writtenEnd !== undefined) {
    await probeEdges({ ...frame, writtenEnd });
  }
});
