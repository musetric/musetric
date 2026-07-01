import { computeBenchStats, selectBenchRunsPerSample } from '@musetric/utils';
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
  benchStableSampleWindow,
  createBenchBands,
  type SpectrogramBenchCase,
  spectrogramBenchConfig,
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

type BenchDriver = {
  config: SpectrogramConfig;
  prime: (processor: SpectrogramProcessor) => Promise<void>;
  render: (processor: SpectrogramProcessor) => Promise<void>;
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

const averageMetrics = (
  metricsList: SpectrogramProcessorMetrics[],
): SpectrogramProcessorMetrics => {
  if (metricsList.length < 1) {
    return {};
  }
  const labels = new Set<string>();
  for (const metrics of metricsList) {
    for (const label of Object.keys(metrics)) {
      labels.add(label);
    }
  }
  const result: SpectrogramProcessorMetrics = {};
  for (const label of labels) {
    let sum = 0;
    for (const metrics of metricsList) {
      sum += metrics[label] ?? 0;
    }
    result[label] = sum / metricsList.length;
  }
  return result;
};

const aggregate = (
  samples: SpectrogramProcessorMetrics[],
): SpectrogramBenchMetric[] => {
  const labels = new Set<string>();
  for (const metrics of samples) {
    for (const label of Object.keys(metrics)) {
      labels.add(label);
    }
  }
  return [...labels].map((label) => {
    const values = samples.map((metrics) => metrics[label] ?? Number.NaN);
    const { mean, cv } = computeBenchStats(values, spectrogramBenchConfig);
    return { label, mean, cv };
  });
};

const pilotSampleCount = 8;

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
    prime,
    render,
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
  const sampleMetrics: SpectrogramProcessorMetrics[] = [];
  const processor = createSpectrogramProcessor({
    device: profiledDevice,
    config: driver.config,
    onMetrics: (metrics) => metricsArray.push(addDerivedMetrics(metrics)),
  });

  try {
    await warmup(driver, processor);
    metricsArray.length = 0;

    for (let i = 0; i < pilotSampleCount; i += 1) {
      await driver.render(processor);
    }
    const pilotTotals = metricsArray.map((metrics) => metrics.total);
    const sampleSize = Math.max(
      1,
      selectBenchRunsPerSample(pilotTotals, spectrogramBenchConfig),
    );
    metricsArray.length = 0;

    for (let tryIndex = 0; tryIndex < benchMaxTries; tryIndex += 1) {
      for (let i = 0; i < benchBatchSize; i += 1) {
        const startCount = metricsArray.length;
        for (let j = 0; j < sampleSize; j += 1) {
          await driver.render(processor);
        }
        const batch = metricsArray.slice(startCount);
        sampleMetrics.push(averageMetrics(batch));
      }
      if (sampleMetrics.length < benchStableSampleWindow) {
        continue;
      }
      const sampleTotals = sampleMetrics.map((metrics) => metrics.total);
      const { cv } = computeBenchStats(sampleTotals, spectrogramBenchConfig);
      if (cv <= benchStableCvPercent) {
        break;
      }
    }

    return {
      metrics: aggregate(sampleMetrics),
      sampleCount: sampleMetrics.length,
    };
  } finally {
    processor.dispose();
  }
};

const measureWall = async (
  benchCase: SpectrogramBenchCase,
): Promise<SpectrogramBenchMetric> => {
  const driver = createDriver(benchCase);
  const pilotDurations: number[] = [];
  const sampleDurations: number[] = [];
  const processor = createSpectrogramProcessor({
    device: wallDevice,
    config: driver.config,
  });

  try {
    await warmup(driver, processor);

    for (let i = 0; i < pilotSampleCount; i += 1) {
      const start = performance.now();
      await driver.render(processor);
      pilotDurations.push(performance.now() - start);
    }
    const sampleSize = Math.max(
      1,
      selectBenchRunsPerSample(pilotDurations, spectrogramBenchConfig),
    );

    for (let tryIndex = 0; tryIndex < benchMaxTries; tryIndex += 1) {
      for (let i = 0; i < benchBatchSize; i += 1) {
        const start = performance.now();
        for (let j = 0; j < sampleSize; j += 1) {
          await driver.render(processor);
        }
        sampleDurations.push((performance.now() - start) / sampleSize);
      }
      if (sampleDurations.length < benchStableSampleWindow) {
        continue;
      }
      const { cv } = computeBenchStats(sampleDurations, spectrogramBenchConfig);
      if (cv <= benchStableCvPercent) {
        break;
      }
    }

    const { mean, cv } = computeBenchStats(
      sampleDurations,
      spectrogramBenchConfig,
    );
    return {
      label: 'wall',
      mean,
      cv,
    };
  } finally {
    processor.dispose();
  }
};

export const measureCase = async (
  benchCase: SpectrogramBenchCase,
  timestamp: string,
): Promise<SpectrogramBenchSummary> => {
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
    sampleSeconds: benchCase.scenario.sampleSeconds,
    framesPerRender: benchCase.scenario.framesPerRender,
    invalidatedFrames:
      benchCase.scenario.invalidatedFrames *
      (benchCase.scenario.invalidatedChunkCount ?? 1),
    metrics,
    sampleCount: profiled.sampleCount,
  };
};
