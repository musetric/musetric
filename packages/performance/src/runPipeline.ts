import { type FourierMode } from '@musetric/fft';
import {
  createSpectrogramProcessor,
  defaultSpectrogramConfig,
  type SpectrogramConfig,
  type SpectrogramSpectralBand,
} from '@musetric/spectrogram/gpu';
import { computeBenchStats, computeCvPercent } from '@musetric/utils';
import {
  benchBatchSize,
  type BenchmarkBandCount,
  type BenchmarkParams,
  benchMaxTries,
  benchStableCvPercent,
  progress,
  recordingSamples,
  samples,
  viewSizePresets,
  warmupIters,
} from './constants.js';

export type RunPipelineOptions = {
  device: GPUDevice;
  canvas: OffscreenCanvas;
  fourierMode: FourierMode;
  windowSize: number;
  params: BenchmarkParams;
};

type Spread = { low: number; high: number };

const createSpectralBands = (
  windowSize: number,
  bandCount: BenchmarkBandCount,
): SpectrogramSpectralBand[] => {
  if (bandCount === 1) {
    return [
      {
        label: `${windowSize}`,
        windowSize,
        minFrequency: 120,
        fullMinFrequency: 120,
        fullMaxFrequency: 4000,
        maxFrequency: 4000,
      },
    ];
  }
  const half = windowSize / 2;
  const quarter = windowSize / 4;
  return [
    {
      label: `${windowSize}`,
      windowSize,
      minFrequency: 20,
      fullMinFrequency: 20,
      fullMaxFrequency: 300,
      maxFrequency: 900,
    },
    {
      label: `${half}`,
      windowSize: half,
      minFrequency: 300,
      fullMinFrequency: 900,
      fullMaxFrequency: 2200,
      maxFrequency: 4200,
    },
    {
      label: `${quarter}`,
      windowSize: quarter,
      minFrequency: 2200,
      fullMinFrequency: 4200,
      fullMaxFrequency: 20_000,
      maxFrequency: 20_000,
    },
  ];
};

const benchStatsConfig = {
  batchSize: benchBatchSize,
  maxTries: benchMaxTries,
  stableCvPercent: benchStableCvPercent,
  targetSampleMs: 1,
  maxRunsPerSample: 1,
  stableSampleWindow: benchBatchSize * 3,
  trimFraction: 0.1,
} as const;

export const runPipeline = async (
  options: RunPipelineOptions,
): Promise<{
  first: Record<string, number>;
  median: Record<string, number>;
  spread: Record<string, Spread>;
}> => {
  const { device, canvas, fourierMode, windowSize, params } = options;
  const viewSize = viewSizePresets[params.viewSizeKey];
  const metricsArray: Record<string, number>[] = [];
  const config: SpectrogramConfig = {
    ...defaultSpectrogramConfig,
    canvas,
    fourierMode,
    windowSize,
    visibleTime: params.visibleTime,
    zeroPaddingFactor: params.zeroPaddingFactor,
    spectralBands: createSpectralBands(windowSize, params.bandCount),
    viewSize: {
      width: viewSize.width,
      height: viewSize.height,
    },
    lanes: {
      lead: {
        ...defaultSpectrogramConfig.lanes.lead,
        showSpectrogram: true,
        showFundamental: true,
      },
      recording: {
        ...defaultSpectrogramConfig.lanes.recording,
        showSpectrogram: params.recordingSpectrogram,
        showFundamental: true,
      },
    },
  };
  const processor = createSpectrogramProcessor({
    device,
    config,
    onMetrics: metricsArray.push.bind(metricsArray),
  });

  const renderSamples = () => {
    const lead = samples.subarray(0);
    const recording = recordingSamples.subarray(0);
    if (params.trackScope === 'lead') {
      return { lead };
    }
    if (params.trackScope === 'recording') {
      return { recording };
    }
    return { lead, recording };
  };

  for (let i = 0; i < warmupIters; i++) {
    await processor.render(renderSamples(), progress);
  }
  metricsArray.length = 0;

  for (let tryIndex = 0; tryIndex < benchMaxTries; tryIndex++) {
    for (let i = 0; i < benchBatchSize; i++) {
      await processor.render(renderSamples(), progress);
    }

    const totals = metricsArray.map((m) => m.total);
    const { cv } = computeBenchStats(totals, benchStatsConfig);

    if (cv <= benchStableCvPercent) {
      break;
    }
  }

  processor.dispose();

  const first = metricsArray[0] ?? {};
  const keys = Object.keys(first);

  const median: Record<string, number> = {};
  const spread: Record<string, Spread> = {};

  for (const key of keys) {
    const values = metricsArray.map((m) => m[key]);
    const stats = computeBenchStats(values, benchStatsConfig);
    median[key] = stats.mean;

    const sorted = [...values].sort((a, b) => a - b);
    const cv = computeCvPercent(sorted);
    const halfRange = (stats.mean * cv) / 100 / 2;
    spread[key] = { low: halfRange, high: halfRange };
  }

  return { first, median, spread };
};
