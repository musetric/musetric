import { type SpectrogramProcessor } from '@musetric/spectrogram/gpu';
import { defaultSampleRate } from '@musetric/utils';
import { findDrawnEdges } from '../analysis/edges.js';

const probeEvery = 3;
const energyFrequency = 1000;

type RenderedFrame = {
  processor: SpectrogramProcessor;
  startedAt: number;
  playheadFrame: number;
  writtenEnd: number;
};

type WorkerHooks = {
  setRenderListener: (
    listener: ((frame: RenderedFrame) => Promise<void>) | undefined,
  ) => void;
};

declare const musetricMeasureHooks: WorkerHooks | undefined;

const createEdgeProbe = (sampleRate: number) => {
  let renderCount = 0;
  return async (frame: RenderedFrame) => {
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
musetricMeasureHooks.setRenderListener(createEdgeProbe(defaultSampleRate));
