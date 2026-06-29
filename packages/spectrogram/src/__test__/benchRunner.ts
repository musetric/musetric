import { computeBenchStats } from '@musetric/utils';
import { createGpuContext } from '@musetric/utils/gpu';
import { type SpectrogramSampleRange } from '../common/extConfig.js';
import { type SpectrogramProcessorMetrics } from '../common/processorTimer.js';
import { type SpectrogramConfig } from '../config.cross.js';
import { defaultSpectrogramConfig } from '../defaultConfig.cross.js';
import {
  createSpectrogramProcessor,
  type SpectrogramProcessor,
} from '../processor.js';
import {
  benchBatchSize,
  benchMaxTries,
  benchStableCvPercent,
  createBenchBands,
  type SpectrogramBenchCase,
  type SpectrogramBenchMetric,
  type SpectrogramBenchSummary,
  warmupIters,
} from './bench.es.js';
import { buildConfig, createTone } from './common.js';

const profiledContext = await createGpuContext(true);
const wallContext = await createGpuContext();
const profiledDevice = profiledContext.device;
const wallDevice = wallContext.device;

const progressStart = 0.2;

const getInvalidatedChunkCount = (benchCase: SpectrogramBenchCase): number =>
  benchCase.scenario.invalidatedChunkCount ?? 1;

type BenchDriver = {
  config: SpectrogramConfig;
  framesPerRender: number;
  invalidatedFrames: number;
  prime: (processor: SpectrogramProcessor) => Promise<void>;
  render: (processor: SpectrogramProcessor) => Promise<void>;
  sampleSeconds: number;
};

const buildPresetConfig = (
  benchCase: SpectrogramBenchCase,
): SpectrogramConfig =>
  buildConfig({
    windowSize: benchCase.windowSize,
    zeroPaddingFactor: 2,
    spectralBands: createBenchBands(benchCase.windowSize, benchCase.bandCount),
    viewSize: { width: benchCase.width, height: benchCase.height },
    lanes: {
      lead: {
        ...defaultSpectrogramConfig.lanes.lead,
        showSpectrogram: true,
        showFundamental: true,
      },
      recording: {
        ...defaultSpectrogramConfig.lanes.recording,
        showSpectrogram: false,
        showFundamental: true,
      },
    },
  });

const aggregate = (
  metricsArray: SpectrogramProcessorMetrics[],
): SpectrogramBenchMetric[] => {
  const labels = new Set<string>();
  for (const metrics of metricsArray) {
    for (const label of Object.keys(metrics)) {
      labels.add(label);
    }
  }
  return [...labels].map((label) => {
    const values = metricsArray.map((metrics) => metrics[label] ?? Number.NaN);
    const { mean, cv } = computeBenchStats(values);
    return { label, mean, cv };
  });
};

const gpuComputeLabels = [
  'sliceSamples',
  'fourierTransform',
  'magnitudify',
  'decibelify',
  'fundamentalFrequency',
  'remap',
] as const;

const addDerivedMetrics = (
  metrics: SpectrogramProcessorMetrics,
): SpectrogramProcessorMetrics => {
  const gpuCompute = gpuComputeLabels.reduce(
    (sum, label) => sum + (metrics[label] ?? 0),
    0,
  );
  return {
    ...metrics,
    gpuCompute,
    gpuWork: gpuCompute + metrics.draw,
  };
};

const createRecordingInvalidations = (
  scenario: SpectrogramBenchCase['scenario'],
  frameIndex: number,
): SpectrogramSampleRange[] => {
  const chunkCount = scenario.invalidatedChunkCount ?? 1;
  const gap = scenario.invalidatedChunkGapFrames ?? scenario.invalidatedFrames;
  return Array.from({ length: chunkCount }, (_, index) => ({
    frameIndex: Math.max(0, frameIndex - index * gap),
    frameCount: scenario.invalidatedFrames,
  }));
};

const coalesceInvalidations = (
  invalidations: readonly SpectrogramSampleRange[],
): SpectrogramSampleRange[] => {
  const sorted = [...invalidations].sort((a, b) => a.frameIndex - b.frameIndex);
  const merged: SpectrogramSampleRange[] = [];
  for (const invalidation of sorted) {
    if (invalidation.frameCount <= 0) {
      continue;
    }
    const nextStart = invalidation.frameIndex;
    const nextEnd = invalidation.frameIndex + invalidation.frameCount;
    if (merged.length > 0) {
      const previous = merged[merged.length - 1];
      const previousEnd = previous.frameIndex + previous.frameCount;
      if (nextStart <= previousEnd) {
        previous.frameCount =
          Math.max(previousEnd, nextEnd) - previous.frameIndex;
        continue;
      }
    }
    merged.push({ ...invalidation });
  }
  return merged;
};

const toRenderInvalidations = (
  scenario: SpectrogramBenchCase['scenario'],
  invalidations: readonly SpectrogramSampleRange[],
): SpectrogramSampleRange[] =>
  scenario.coalesceInvalidations
    ? coalesceInvalidations(invalidations)
    : [...invalidations];

const writeRecordingChunk = (
  samples: Float32Array,
  frameIndex: number,
  frameCount: number,
  sampleRate: number,
  renderIndex: number,
): number => {
  const start = Math.max(0, Math.min(samples.length, frameIndex));
  const end = Math.max(start, Math.min(samples.length, start + frameCount));
  const phase = renderIndex * 0.13;
  for (let index = start; index < end; index += 1) {
    samples[index] = Math.sin(
      phase + (2 * Math.PI * 440 * (index - start)) / sampleRate,
    );
  }
  return end - start;
};

const createDriver = (benchCase: SpectrogramBenchCase): BenchDriver => {
  const config = buildPresetConfig(benchCase);
  const { scenario } = benchCase;
  const sampleCount = Math.round(config.sampleRate * scenario.sampleSeconds);
  const lead = createTone(sampleCount, 1000, config.sampleRate, 0.8);
  const recording = createTone(sampleCount, 440, config.sampleRate, 0.55);
  const samples = { lead, recording };
  const { framesPerRender } = scenario;
  const progressStep = framesPerRender / sampleCount;

  let progress = progressStart;
  let renderIndex = 0;

  const prime = async (processor: SpectrogramProcessor): Promise<void> => {
    await processor.render(samples, progress);
  };

  const render = async (processor: SpectrogramProcessor): Promise<void> => {
    renderIndex += 1;

    if (scenario.kind === 'full') {
      await processor.render(
        { lead: lead.subarray(0), recording: recording.subarray(0) },
        progress,
      );
      return;
    }

    if (scenario.kind === 'recording') {
      progress += progressStep;
      const frameIndex = Math.round(progress * sampleCount);
      const chunks = createRecordingInvalidations(scenario, frameIndex);
      const writtenChunks = chunks
        .map((invalidation, invalidationIndex) => ({
          frameIndex: invalidation.frameIndex,
          frameCount: writeRecordingChunk(
            recording,
            invalidation.frameIndex,
            invalidation.frameCount,
            config.sampleRate,
            renderIndex + invalidationIndex,
          ),
        }))
        .filter((invalidation) => invalidation.frameCount > 0);
      const renderInvalidations = toRenderInvalidations(
        scenario,
        writtenChunks,
      );
      processor.invalidateSamples(
        renderInvalidations.map((invalidation) => ({
          trackKey: 'recording',
          frameIndex: invalidation.frameIndex,
          frameCount: invalidation.frameCount,
        })),
      );
      await processor.render(samples, progress);
      return;
    }

    progress += progressStep;
    await processor.render(samples, progress);
  };

  return {
    config,
    framesPerRender,
    invalidatedFrames:
      scenario.invalidatedFrames * getInvalidatedChunkCount(benchCase),
    prime,
    render,
    sampleSeconds: scenario.sampleSeconds,
  };
};

const warmup = async (
  driver: BenchDriver,
  processor: SpectrogramProcessor,
): Promise<void> => {
  await driver.prime(processor);
  for (let i = 0; i < warmupIters; i += 1) {
    await driver.render(processor);
  }
};

const measureProfiled = async (
  benchCase: SpectrogramBenchCase,
): Promise<{
  metrics: SpectrogramBenchMetric[];
  sampleCount: number;
}> => {
  const driver = createDriver(benchCase);
  const metricsArray: SpectrogramProcessorMetrics[] = [];
  const processor = createSpectrogramProcessor({
    device: profiledDevice,
    config: driver.config,
    onMetrics: (metrics) => metricsArray.push(addDerivedMetrics(metrics)),
  });

  try {
    await warmup(driver, processor);
    metricsArray.length = 0;

    for (let tryIndex = 0; tryIndex < benchMaxTries; tryIndex += 1) {
      for (let i = 0; i < benchBatchSize; i += 1) {
        await driver.render(processor);
      }
      const totals = metricsArray.map((metrics) => metrics.total);
      const { cv } = computeBenchStats(totals);
      if (cv <= benchStableCvPercent) {
        break;
      }
    }

    return {
      metrics: aggregate(metricsArray),
      sampleCount: metricsArray.length,
    };
  } finally {
    processor.dispose();
  }
};

const measureWall = async (
  benchCase: SpectrogramBenchCase,
): Promise<SpectrogramBenchMetric> => {
  const driver = createDriver(benchCase);
  const durations: number[] = [];
  const processor = createSpectrogramProcessor({
    device: wallDevice,
    config: driver.config,
  });

  try {
    await warmup(driver, processor);

    for (let tryIndex = 0; tryIndex < benchMaxTries; tryIndex += 1) {
      for (let i = 0; i < benchBatchSize; i += 1) {
        const start = performance.now();
        await driver.render(processor);
        durations.push(performance.now() - start);
      }
      const { cv } = computeBenchStats(durations);
      if (cv <= benchStableCvPercent) {
        break;
      }
    }

    const { mean, cv } = computeBenchStats(durations);
    return {
      label: 'wall',
      mean,
      cv,
    };
  } finally {
    processor.dispose();
  }
};

const measureCase = async (
  benchCase: SpectrogramBenchCase,
  timestamp: string,
): Promise<SpectrogramBenchSummary> => {
  const driver = createDriver(benchCase);
  const wallMetric = await measureWall(benchCase);
  const profiled = await measureProfiled(benchCase);
  const metrics = [wallMetric, ...profiled.metrics];
  const totalMetric = metrics.find((metric) => metric.label === 'total');
  const caseLabel = `${benchCase.label}/${benchCase.scenario.label}`;
  console.log(
    `${benchCase.bandCount}band ${benchCase.scenario.label} total=${totalMetric?.mean.toFixed(3) ?? 'n/a'}ms`,
  );

  return {
    timestamp,
    caseLabel,
    preset: benchCase.label,
    scenario: benchCase.scenario.label,
    windowSize: benchCase.windowSize,
    bandCount: benchCase.bandCount,
    sampleSeconds: driver.sampleSeconds,
    framesPerRender: driver.framesPerRender,
    invalidatedFrames: driver.invalidatedFrames,
    metrics,
    sampleCount: profiled.sampleCount,
  };
};

export const runSingleBench = async (
  benchCase: SpectrogramBenchCase,
  timestamp: string,
): Promise<SpectrogramBenchSummary> => measureCase(benchCase, timestamp);
