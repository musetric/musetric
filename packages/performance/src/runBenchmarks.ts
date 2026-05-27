import { type FourierMode } from '@musetric/audio/spectrogram';
import { type BenchmarkParams } from './constants.js';
import { runPipeline } from './runPipeline.js';
import { waitNextFrame } from './waitNextFrame.js';

export type MetricsData = {
  first: Record<string, number>;
  median: Record<string, number>;
  spread: Record<string, { low: number; high: number }>;
};

export type BenchmarkData = Record<FourierMode, Record<number, MetricsData>>;

export type RunBenchmarkOptions = {
  device: GPUDevice;
  canvas: OffscreenCanvas;
  fourierMode: FourierMode;
  windowSize: number;
  params: BenchmarkParams;
};

export const runBenchmark = async (options: RunBenchmarkOptions) => {
  const metrics = await runPipeline(options);
  await waitNextFrame();
  return metrics;
};
