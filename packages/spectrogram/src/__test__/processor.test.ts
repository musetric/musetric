import { createGpuContext } from '@musetric/utils/gpu';
import { describe, expect, it } from 'vitest';
import { type SpectrogramConfig } from '../config.cross.js';
import { type SpectrogramProcessor } from '../processor.js';
import {
  brightestRow,
  countDifferences,
  createSilence,
  createTone,
  maxRed,
  readCanvas,
  rowAtFrequency,
} from './common.js';
import {
  device,
  expectMatchesReference,
  progressForColumns,
  singleBandConfig,
  toneFrequency,
  withProcessor,
  writeCentreTone,
} from './processor.fixtures.js';

type PixelRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

const maxRedInRect = (
  pixels: Uint8ClampedArray,
  width: number,
  rect: PixelRect,
): number => {
  let max = 0;
  for (let y = rect.top; y < rect.bottom; y += 1) {
    for (let x = rect.left; x < rect.right; x += 1) {
      max = Math.max(max, pixels[(y * width + x) * 4]);
    }
  }
  return max;
};

const stackedConfig = () => {
  const base = singleBandConfig();
  return singleBandConfig({
    lanes: {
      ...base.lanes,
      recording: { ...base.lanes.recording, showSpectrogram: true },
    },
  });
};

describe('spectrogram processor', () => {
  it('draws the lead across the whole width above the recording', async () => {
    const config = stackedConfig();
    await withProcessor({ device, config }, async (processor) => {
      const length = config.sampleRate * 5;
      const lead = createTone(length, toneFrequency, config.sampleRate);
      const recording = createSilence(length);
      await processor.render({ lead, recording }, 0.5);
      const pixels = await readCanvas(config.canvas);
      const { width, height } = config.viewSize;
      const split = Math.floor(height / 2);
      const playhead = Math.floor(config.playheadRatio * width);
      expect(
        maxRedInRect(pixels, width, {
          left: 0,
          right: playhead - 1,
          top: 0,
          bottom: split,
        }),
      ).toBeGreaterThan(40);
      expect(
        maxRedInRect(pixels, width, {
          left: 0,
          right: width,
          top: split + 1,
          bottom: height,
        }),
      ).toBeLessThan(16);
    });
  });

  it('draws the recording in its own frequency rows below the lead', async () => {
    const config = stackedConfig();
    await withProcessor({ device, config }, async (processor) => {
      const length = config.sampleRate * 5;
      const lead = createSilence(length);
      const recording = createTone(length, toneFrequency, config.sampleRate);
      await processor.render({ lead, recording }, 0.5);
      const pixels = await readCanvas(config.canvas);
      const { width, height } = config.viewSize;
      const split = Math.floor(height / 2);
      const bandHeight = height - split;
      expect(
        maxRedInRect(pixels, width, {
          left: 0,
          right: width,
          top: 0,
          bottom: split,
        }),
      ).toBeLessThan(16);

      const recordingBand = pixels.subarray(split * width * 4);
      const expectedRow = rowAtFrequency(toneFrequency, {
        ...config,
        viewSize: { width, height: bandHeight },
      });
      const actualRow = brightestRow(recordingBand, width, bandHeight);
      expect(Math.abs(actualRow - expectedRow)).toBeLessThan(bandHeight * 0.15);
    });
  });

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

      expectMatchesReference(plainPixels, meteredPixels);
    } finally {
      profilingDevice.destroy();
    }
  });
});
