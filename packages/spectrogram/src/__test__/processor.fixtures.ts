import { createGpuContext } from '@musetric/utils/gpu';
import { expect } from 'vitest';
import { allTrackKeys, type SpectrogramConfig } from '../config.cross.js';
import { defaultSpectrogramConfig } from '../defaultConfig.cross.js';
import {
  createSpectrogramProcessor,
  type CreateSpectrogramProcessorOptions,
  type SpectrogramProcessor,
  type SpectrogramSamples,
} from '../processor.js';
import { buildConfig, maxAbsDifference, maxRed, readCanvas } from './common.js';

export const windowSize = 2048;
export const toneFrequency = 1000;

export const { device } = await createGpuContext();

export const singleBandConfig = (
  overrides: Partial<SpectrogramConfig> = {},
): SpectrogramConfig =>
  buildConfig({
    windowSize,
    zeroPaddingFactor: 1,
    minFrequency: 120,
    maxFrequency: 4000,
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
    lanes: {
      lead: {
        ...defaultSpectrogramConfig.lanes.lead,
        showSpectrogram: true,
        showFundamental: false,
      },
      recording: {
        ...defaultSpectrogramConfig.lanes.recording,
        showSpectrogram: false,
        showFundamental: false,
      },
    },
    viewSize: { width: 128, height: 128 },
    ...overrides,
  });

export const withProcessor = async <T>(
  options: CreateSpectrogramProcessorOptions,
  fn: (processor: SpectrogramProcessor) => Promise<T>,
): Promise<T> => {
  const processor = createSpectrogramProcessor(options);
  try {
    return await fn(processor);
  } finally {
    processor.dispose();
  }
};

export const withTwoProcessors = async <T>(
  incrementalOptions: CreateSpectrogramProcessorOptions,
  fullOptions: CreateSpectrogramProcessorOptions,
  fn: (
    incremental: SpectrogramProcessor,
    full: SpectrogramProcessor,
  ) => Promise<T>,
): Promise<T> =>
  withProcessor(incrementalOptions, async (incremental) =>
    withProcessor(fullOptions, async (full) => fn(incremental, full)),
  );

export const renderFromScratch = async (
  processor: SpectrogramProcessor,
  config: SpectrogramConfig,
  samples: SpectrogramSamples,
  progress: number,
): Promise<Uint8ClampedArray> => {
  const copy: SpectrogramSamples = {};
  for (const key of allTrackKeys) {
    const track = samples[key];
    if (track) {
      copy[key] = Float32Array.from(track);
    }
  }
  await processor.render(copy, progress);
  return readCanvas(config.canvas);
};

export const expectMatchesReference = (
  actual: Uint8ClampedArray,
  reference: Uint8ClampedArray,
): void => {
  expect(maxRed(actual)).toBeGreaterThan(40);
  expect(maxAbsDifference(actual, reference)).toBeLessThan(8);
};

type WriteToneRangeOptions = {
  samples: Float32Array;
  frameIndex: number;
  frameCount: number;
  frequency: number;
  sampleRate: number;
};

export const writeToneRange = (options: WriteToneRangeOptions): void => {
  const { samples, frameIndex, frameCount, frequency, sampleRate } = options;
  const start = Math.max(0, frameIndex);
  const end = Math.min(samples.length, frameIndex + frameCount);
  for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
    samples[sampleIndex] = Math.sin(
      (2 * Math.PI * frequency * sampleIndex) / sampleRate,
    );
  }
};

export const writeCentreTone = (
  lead: Float32Array,
  sampleRate: number,
): { trackKey: 'lead'; frameIndex: number; frameCount: number } => {
  const chunkLength = windowSize * 2;
  const chunkStart = Math.floor(lead.length * 0.5 - chunkLength * 0.5);
  writeToneRange({
    samples: lead,
    frameIndex: chunkStart,
    frameCount: chunkLength,
    frequency: toneFrequency,
    sampleRate,
  });
  return { trackKey: 'lead', frameIndex: chunkStart, frameCount: chunkLength };
};

export const progressForColumns = (
  config: SpectrogramConfig,
  sampleLength: number,
  columns: number,
): number => {
  const step =
    (config.visibleTime * config.sampleRate) / (config.viewSize.width - 1);
  return (columns * step) / sampleLength;
};
