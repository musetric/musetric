import { computeBenchStats, selectBenchRunsPerSample } from '@musetric/utils';
import { createGpuContext } from '@musetric/utils/gpu';
import { type SpectrogramProcessorMetrics } from '../common/processorTimer.js';
import {
  createSpectrogramProcessor,
  type SpectrogramProcessor,
} from '../processor.js';
import {
  type SpectrogramBenchCase,
  spectrogramBenchConfig,
  type SpectrogramBenchMetric,
  type SpectrogramBenchSummary,
} from './bench.es.js';
import { createDriver, renderDriverSamples, warmup } from './benchDriver.js';
import {
  addDerivedMetrics,
  aggregateMetrics,
  averageMetrics,
  pilotSampleCount,
} from './benchMetrics.js';

const profiledContext = await createGpuContext(true);
const wallContext = await createGpuContext();

type ProfiledMeasurement = {
  metrics: SpectrogramBenchMetric[];
  sampleCount: number;
};

const measureProfiled = async (
  benchCase: SpectrogramBenchCase,
): Promise<ProfiledMeasurement> => {
  const driver = createDriver(benchCase);
  const metricsArray: SpectrogramProcessorMetrics[] = [];
  const sampleMetrics: SpectrogramProcessorMetrics[] = [];
  const processor: SpectrogramProcessor = createSpectrogramProcessor({
    device: profiledContext.device,
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

    for (
      let tryIndex = 0;
      tryIndex < spectrogramBenchConfig.maxTries;
      tryIndex += 1
    ) {
      for (let i = 0; i < spectrogramBenchConfig.batchSize; i += 1) {
        const startCount = metricsArray.length;
        await renderDriverSamples(driver, processor, sampleSize);
        const batch = metricsArray.slice(startCount);
        sampleMetrics.push(averageMetrics(batch));
      }
      if (sampleMetrics.length < spectrogramBenchConfig.stableSampleWindow) {
        continue;
      }
      const sampleTotals = sampleMetrics.map((metrics) => metrics.total);
      const { cv } = computeBenchStats(sampleTotals, spectrogramBenchConfig);
      if (cv <= spectrogramBenchConfig.stableCvPercent) {
        break;
      }
    }

    return {
      metrics: aggregateMetrics(sampleMetrics),
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
    device: wallContext.device,
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

    for (
      let tryIndex = 0;
      tryIndex < spectrogramBenchConfig.maxTries;
      tryIndex += 1
    ) {
      for (let i = 0; i < spectrogramBenchConfig.batchSize; i += 1) {
        const start = performance.now();
        await renderDriverSamples(driver, processor, sampleSize);
        sampleDurations.push((performance.now() - start) / sampleSize);
      }
      if (sampleDurations.length < spectrogramBenchConfig.stableSampleWindow) {
        continue;
      }
      const { cv } = computeBenchStats(sampleDurations, spectrogramBenchConfig);
      if (cv <= spectrogramBenchConfig.stableCvPercent) {
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
