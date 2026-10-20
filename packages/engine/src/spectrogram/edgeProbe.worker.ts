import {
  type SpectrogramColumnValues,
  type SpectrogramProcessor,
} from '@musetric/spectrogram/gpu';

const probeEvery = 3;
const energyFrequency = 1000;
const referenceStartSeconds = 1.2;
const referenceEndSeconds = 0.4;
const levelShare = 0.5;

const getMedian = (values: number[]) => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

export type DrawnEdges = {
  pitchEdge: number;
  energyEdge: number;
  level: number;
};

export const findDrawnEdges = (
  line: SpectrogramColumnValues,
  energy: SpectrogramColumnValues | undefined,
  playheadFrame: number,
  sampleRate: number,
): DrawnEdges => {
  const frameOf = (index: number) =>
    (line.baseColumn + index) * line.columnStep;
  const referenceStart = playheadFrame - referenceStartSeconds * sampleRate;
  const referenceEnd = playheadFrame - referenceEndSeconds * sampleRate;
  let pitchEdge = -1;
  const reference: number[] = [];
  for (
    let index = 0;
    index < line.values.length && frameOf(index) <= playheadFrame;
    index += 1
  ) {
    const frame = frameOf(index);
    if (line.values[index] > 0) {
      pitchEdge = frame;
    }
    if (energy && frame > referenceStart && frame < referenceEnd) {
      reference.push(energy.values[index]);
    }
  }
  const level = getMedian(reference);
  let energyEdge = -1;
  if (energy && level > 0) {
    for (
      let index = 0;
      index < energy.values.length && frameOf(index) <= playheadFrame;
      index += 1
    ) {
      if (energy.values[index] >= levelShare * level) {
        energyEdge = frameOf(index);
      }
    }
  }
  return { pitchEdge, energyEdge, level };
};

export type EdgeProbeFrame = {
  startedAt: number;
  playheadFrame: number;
  writtenEnd: number;
};

export const createEdgeProbe = (sampleRate: number) => {
  let renderCount = 0;
  return async (processor: SpectrogramProcessor, frame: EdgeProbeFrame) => {
    renderCount += 1;
    if (renderCount % probeEvery !== 0) {
      return;
    }
    const renderedAt = performance.timeOrigin + performance.now();
    const line = await processor.readFundamentalLine('recording');
    if (!line) {
      return;
    }
    const energy = await processor.readColumnEnergy(
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
