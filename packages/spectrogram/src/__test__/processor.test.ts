import { createGpuContext } from '@musetric/utils/gpu';
import { describe, expect, it } from 'vitest';
import { allTrackKeys, type SpectrogramConfig } from '../config.cross.js';
import { defaultSpectrogramConfig } from '../defaultConfig.cross.js';
import {
  createSpectrogramProcessor,
  type CreateSpectrogramProcessorOptions,
  type SpectrogramProcessor,
  type SpectrogramSamples,
} from '../processor.js';
import {
  brightestRow,
  buildConfig,
  countDifferences,
  createSilence,
  createTone,
  maxAbsDifference,
  maxRed,
  readCanvas,
  rowAtFrequency,
} from './common.js';

const { device } = await createGpuContext();

const windowSize = 2048;
const toneFrequency = 1000;

const singleBandConfig = (
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

const withProcessor = async <T>(
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

const withTwoProcessors = async <T>(
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

const renderFromScratch = async (
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

const expectMatchesReference = (
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

const writeToneRange = (options: WriteToneRangeOptions): void => {
  const { samples, frameIndex, frameCount, frequency, sampleRate } = options;
  const start = Math.max(0, frameIndex);
  const end = Math.min(samples.length, frameIndex + frameCount);
  for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
    samples[sampleIndex] = Math.sin(
      (2 * Math.PI * frequency * sampleIndex) / sampleRate,
    );
  }
};

const writeCentreTone = (
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

const progressForColumns = (
  config: SpectrogramConfig,
  sampleLength: number,
  columns: number,
): number => {
  const step =
    (config.visibleTime * config.sampleRate) / (config.viewSize.width - 1);
  return (columns * step) / sampleLength;
};

type WriteRecordingChunksOptions = {
  recording: Float32Array;
  firstChunkFrameIndex: number;
  chunkCount: number;
  chunkFrameCount: number;
  sampleRate: number;
};

const writeRecordingChunks = (
  options: WriteRecordingChunksOptions,
): { trackKey: 'recording'; frameIndex: number; frameCount: number }[] => {
  const {
    recording,
    firstChunkFrameIndex,
    chunkCount,
    chunkFrameCount,
    sampleRate,
  } = options;
  return Array.from({ length: chunkCount }, (_, index) => {
    const chunkFrameIndex = firstChunkFrameIndex + index * chunkFrameCount;
    writeToneRange({
      samples: recording,
      frameIndex: chunkFrameIndex,
      frameCount: chunkFrameCount,
      frequency: 440,
      sampleRate,
    });
    return {
      trackKey: 'recording' as const,
      frameIndex: chunkFrameIndex,
      frameCount: chunkFrameCount,
    };
  });
};

describe('spectrogram processor', () => {
  it('renders a tone into its expected frequency row', async () => {
    const config = singleBandConfig();
    await withProcessor({ device, config }, async (processor) => {
      const lead = createTone(
        config.sampleRate * 5,
        toneFrequency,
        config.sampleRate,
      );
      const ok = await processor.render({ lead }, 0.5);
      expect(ok).toBe(true);

      const pixels = await readCanvas(config.canvas);
      const { width, height } = config.viewSize;

      expect(maxRed(pixels)).toBeGreaterThan(40);

      const expectedRow = rowAtFrequency(toneFrequency, config);
      const actualRow = brightestRow(pixels, width, height);
      expect(Math.abs(actualRow - expectedRow)).toBeLessThan(height * 0.15);
    });
  });

  it('keeps silence dark', async () => {
    const config = singleBandConfig();
    await withProcessor({ device, config }, async (processor) => {
      const lead = createSilence(config.sampleRate * 5);
      await processor.render({ lead }, 0.5);
      const pixels = await readCanvas(config.canvas);
      expect(maxRed(pixels)).toBeLessThan(16);
    });
  });

  it('is deterministic across identical renders', async () => {
    const config = singleBandConfig();
    await withProcessor({ device, config }, async (processor) => {
      const lead = createTone(
        config.sampleRate * 5,
        toneFrequency,
        config.sampleRate,
      );
      await processor.render({ lead }, 0.5);
      const first = await readCanvas(config.canvas);
      await processor.render({ lead }, 0.5);
      const second = await readCanvas(config.canvas);
      expect(countDifferences(first, second)).toBe(0);
    });
  });

  it('requires an invalidated sample chunk after in-place sample mutation', async () => {
    const config = singleBandConfig();
    await withProcessor({ device, config }, async (processor) => {
      const lead = createSilence(config.sampleRate * 5);
      await processor.render({ lead }, 0.5);
      const silent = await readCanvas(config.canvas);
      expect(maxRed(silent)).toBeLessThan(16);

      const invalidation = writeCentreTone(lead, config.sampleRate);
      await processor.render({ lead }, 0.5);
      const stale = await readCanvas(config.canvas);
      expect(countDifferences(silent, stale)).toBe(0);

      processor.invalidateSamples([invalidation]);
      await processor.render({ lead }, 0.5);
      const updated = await readCanvas(config.canvas);
      expect(maxRed(updated)).toBeGreaterThan(40);
    });
  });

  it('keeps resident samples across draw-only config changes', async () => {
    const config = singleBandConfig();
    await withProcessor({ device, config }, async (processor) => {
      const lead = createSilence(config.sampleRate * 5);
      await processor.render({ lead }, 0.5);
      const silent = await readCanvas(config.canvas);
      expect(maxRed(silent)).toBeLessThan(16);

      const invalidation = writeCentreTone(lead, config.sampleRate);
      processor.updateConfig({
        colors: {
          ...config.colors,
          foreground: '#ff0000',
        },
      });
      await processor.render({ lead }, 0.5);
      const stale = await readCanvas(config.canvas);
      expect(maxRed(stale)).toBeLessThan(16);

      processor.invalidateSamples([invalidation]);
      await processor.render({ lead }, 0.5);
      const updated = await readCanvas(config.canvas);
      expect(maxRed(updated)).toBeGreaterThan(40);
    });
  });

  it('matches a full render when slide and recording dirty disjoint columns', async () => {
    const incrementalConfig = singleBandConfig();
    const fullConfig = singleBandConfig();
    await withTwoProcessors(
      { device, config: incrementalConfig },
      { device, config: fullConfig },
      async (incremental, full) => {
        const length = incrementalConfig.sampleRate * 5;
        const lead = createSilence(length);
        const start = 0.5;
        const slide = progressForColumns(incrementalConfig, length, 4);

        await incremental.render({ lead }, start);
        const invalidation = writeCentreTone(
          lead,
          incrementalConfig.sampleRate,
        );
        incremental.invalidateSamples([invalidation]);
        await incremental.render({ lead }, start + slide);
        const incrementalPixels = await readCanvas(incrementalConfig.canvas);

        const fullPixels = await renderFromScratch(
          full,
          fullConfig,
          { lead },
          start + slide,
        );

        expect(maxRed(fullPixels)).toBeGreaterThan(40);
        expectMatchesReference(incrementalPixels, fullPixels);
      },
    );
  });

  it('matches a full render for playback plus adjacent recording chunks', async () => {
    const lanes = {
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
    };
    const incrementalConfig = singleBandConfig({ lanes });
    const fullConfig = singleBandConfig({ lanes });
    await withTwoProcessors(
      { device, config: incrementalConfig },
      { device, config: fullConfig },
      async (incremental, full) => {
        const length = incrementalConfig.sampleRate * 6;
        const lead = createTone(
          length,
          toneFrequency,
          incrementalConfig.sampleRate,
          0.7,
        );
        const recording = createSilence(length);
        const start = 0.5;
        const slide = progressForColumns(incrementalConfig, length, 5);

        await incremental.render({ lead, recording }, start);

        const chunkFrameCount = 256;
        const chunkCount = 3;
        const frameIndex = Math.round((start + slide) * length);
        const firstChunkFrameIndex = frameIndex - chunkFrameCount * chunkCount;
        const invalidatedSamples = writeRecordingChunks({
          recording,
          firstChunkFrameIndex,
          chunkCount,
          chunkFrameCount,
          sampleRate: incrementalConfig.sampleRate,
        });

        incremental.invalidateSamples(invalidatedSamples);
        await incremental.render({ lead, recording }, start + slide);
        const incrementalPixels = await readCanvas(incrementalConfig.canvas);

        const fullPixels = await renderFromScratch(
          full,
          fullConfig,
          { lead, recording },
          start + slide,
        );

        expectMatchesReference(incrementalPixels, fullPixels);
      },
    );
  });

  it('matches a full render with the fundamental line enabled', async () => {
    const fundamentalLanes = {
      lead: {
        ...defaultSpectrogramConfig.lanes.lead,
        showSpectrogram: true,
        showFundamental: true,
      },
      recording: {
        ...defaultSpectrogramConfig.lanes.recording,
        showSpectrogram: false,
        showFundamental: false,
      },
    };
    const incrementalConfig = singleBandConfig({ lanes: fundamentalLanes });
    const fullConfig = singleBandConfig({ lanes: fundamentalLanes });
    await withTwoProcessors(
      { device, config: incrementalConfig },
      { device, config: fullConfig },
      async (incremental, full) => {
        const length = incrementalConfig.sampleRate * 5;
        const lead = createTone(
          length,
          toneFrequency,
          incrementalConfig.sampleRate,
        );

        await incremental.render({ lead }, 0.5);

        const chunkLength = windowSize * 6;
        const chunkStart = Math.floor(length * 0.5 - chunkLength * 0.5);
        writeToneRange({
          samples: lead,
          frameIndex: chunkStart,
          frameCount: chunkLength,
          frequency: toneFrequency * 1.5,
          sampleRate: incrementalConfig.sampleRate,
        });
        const invalidation = {
          trackKey: 'lead' as const,
          frameIndex: chunkStart,
          frameCount: chunkLength,
        };
        incremental.invalidateSamples([invalidation]);
        await incremental.render({ lead }, 0.5);
        const incrementalPixels = await readCanvas(incrementalConfig.canvas);

        const fullPixels = await renderFromScratch(
          full,
          fullConfig,
          { lead },
          0.5,
        );

        expectMatchesReference(incrementalPixels, fullPixels);
      },
    );
  });

  it('matches a full render after a lane-only gain change', async () => {
    const gainedLanes = {
      lead: {
        ...defaultSpectrogramConfig.lanes.lead,
        showSpectrogram: true,
        showFundamental: false,
        gainDb: defaultSpectrogramConfig.lanes.lead.gainDb + 6,
      },
      recording: {
        ...defaultSpectrogramConfig.lanes.recording,
        showSpectrogram: false,
        showFundamental: false,
      },
    };
    const incrementalConfig = singleBandConfig();
    const fullConfig = singleBandConfig({ lanes: gainedLanes });
    await withTwoProcessors(
      { device, config: incrementalConfig },
      { device, config: fullConfig },
      async (incremental, full) => {
        const lead = createTone(
          incrementalConfig.sampleRate * 5,
          toneFrequency,
          incrementalConfig.sampleRate,
        );
        await incremental.render({ lead }, 0.5);
        incremental.updateConfig({ lanes: gainedLanes });
        await incremental.render({ lead }, 0.5);
        const incrementalPixels = await readCanvas(incrementalConfig.canvas);

        const fullPixels = await renderFromScratch(
          full,
          fullConfig,
          { lead },
          0.5,
        );

        expect(maxRed(fullPixels)).toBeGreaterThan(40);
        expectMatchesReference(incrementalPixels, fullPixels);
      },
    );
  });

  it('renders identically with and without profiling', async () => {
    const profilingContext = await createGpuContext(true).catch(
      () => undefined,
    );
    if (!profilingContext) {
      return;
    }
    const profilingDevice = profilingContext.device;

    const drivePlayback = async (
      processor: SpectrogramProcessor,
      config: SpectrogramConfig,
    ): Promise<Uint8ClampedArray> => {
      const length = config.sampleRate * 5;
      const slide = progressForColumns(config, length, 4);
      const lead = createSilence(length);
      await processor.render({ lead }, 0.5);
      const invalidation = writeCentreTone(lead, config.sampleRate);
      processor.invalidateSamples([invalidation]);
      await processor.render({ lead }, 0.5 + slide);
      return readCanvas(config.canvas);
    };

    try {
      const plainConfig = singleBandConfig();
      const meteredConfig = singleBandConfig();
      const plainPixels = await withProcessor(
        { device: profilingDevice, config: plainConfig },
        async (plain) => drivePlayback(plain, plainConfig),
      );
      const meteredPixels = await withProcessor(
        {
          device: profilingDevice,
          config: meteredConfig,
          onMetrics: () => undefined,
        },
        async (metered) => drivePlayback(metered, meteredConfig),
      );

      expect(maxRed(plainPixels)).toBeGreaterThan(40);
      expect(maxAbsDifference(plainPixels, meteredPixels)).toBeLessThan(8);
    } finally {
      profilingDevice.destroy();
    }
  });
});
