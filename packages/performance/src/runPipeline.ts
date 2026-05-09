import {
  createSpectrogramProcessor,
  type FourierMode,
  type SpectrogramConfig,
} from '@musetric/audio/spectrogram';
import { defaultSampleRate } from '@musetric/resource-utils';
import { progress, runs, samples, skipRuns } from './constants.js';
import { waitNextFrame } from './waitNextFrame.js';

export const runPipeline = async (
  device: GPUDevice,
  canvas: OffscreenCanvas,
  fourierMode: FourierMode,
  windowSize: number,
): Promise<{
  first: Record<string, number>;
  average: Record<string, number>;
  maxDeviation: Record<string, { positive: number; negative: number }>;
}> => {
  const metricsArray: Record<string, number>[] = [];
  const config: SpectrogramConfig = {
    canvas,
    fourierMode,
    windowSize,
    sampleRate: defaultSampleRate,
    visibleTime: 4.0,
    playheadRatio: 0.5,
    zeroPaddingFactor: 1,
    windowName: 'hamming',
    minDecibel: -40,
    minFrequency: 120,
    maxFrequency: 4000,
    viewSize: {
      width: canvas.width,
      height: canvas.height,
    },
    colors: {
      background: '#000000',
      foreground: '#888888',
    },
  };
  const processor = createSpectrogramProcessor({
    device,
    config,
    onMetrics: (metrics) => metricsArray.push(metrics),
  });

  for (let i = 0; i < skipRuns + runs; i++) {
    await processor.render(samples, progress);
    await waitNextFrame(15);
  }
  processor.dispose();

  const first = metricsArray[0] ?? {};
  const average: Record<string, number> = {};
  const maxDeviation: Record<string, { positive: number; negative: number }> =
    {};
  const keys = Object.keys(first);

  for (const key of keys) {
    let sum = 0;
    for (const metrics of metricsArray.slice(skipRuns)) {
      sum += metrics[key] ?? 0;
    }
    average[key] = sum / runs;
  }

  for (const key of keys) {
    let maxPositive = 0;
    let maxNegative = 0;
    const avg = average[key] ?? 0;

    for (const metrics of metricsArray.slice(skipRuns)) {
      const value = metrics[key] ?? 0;
      const deviation = value - avg;
      if (deviation > maxPositive) {
        maxPositive = deviation;
      }
      if (deviation < maxNegative) {
        maxNegative = deviation;
      }
    }

    maxDeviation[key] = {
      positive: maxPositive,
      negative: Math.abs(maxNegative),
    };
  }

  return { first, average, maxDeviation };
};
