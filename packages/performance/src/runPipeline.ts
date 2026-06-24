import { type FourierMode } from '@musetric/fft';
import {
  createSpectrogramProcessor,
  defaultSpectrogramConfig,
  type SpectrogramConfig,
} from '@musetric/spectrogram/gpu';
import {
  type BenchmarkParams,
  measureIters,
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

const quantile = (sorted: number[], q: number): number => {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0] ?? 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const loVal = sorted[lo] ?? 0;
  const hiVal = sorted[hi] ?? 0;
  if (lo === hi) return loVal;
  return loVal + (hiVal - loVal) * (pos - lo);
};

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
    spectralBands: [
      {
        label: `${windowSize}`,
        windowSize,
        minFrequency: 120,
        fullMinFrequency: 120,
        fullMaxFrequency: 4000,
        maxFrequency: 4000,
      },
    ],
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
        showSpectrogram: true,
        showFundamental: true,
      },
    },
  };
  const processor = createSpectrogramProcessor({
    device,
    config,
    onMetrics: (metrics) => metricsArray.push(metrics),
  });

  const totalIters = warmupIters + measureIters;
  for (let i = 0; i < totalIters; i++) {
    await processor.render(
      { lead: samples, recording: recordingSamples },
      progress,
    );
  }
  processor.dispose();

  const first = metricsArray[0] ?? {};
  const measured = metricsArray.slice(warmupIters);
  const keys = Object.keys(first);

  const median: Record<string, number> = {};
  const spread: Record<string, Spread> = {};

  for (const key of keys) {
    const values = measured
      .map((metrics) => metrics[key] ?? 0)
      .sort((a, b) => a - b);
    const p25 = quantile(values, 0.25);
    const p50 = quantile(values, 0.5);
    const p75 = quantile(values, 0.75);
    median[key] = p50;
    spread[key] = {
      low: Math.max(0, p50 - p25),
      high: Math.max(0, p75 - p50),
    };
  }

  return { first, median, spread };
};
