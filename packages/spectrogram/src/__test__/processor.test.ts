import { createGpuContext } from '@musetric/utils/gpu';
import { describe, expect, it } from 'vitest';
import { stackedLaneRadius } from '../common/stackedLanes.es.js';
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
  stackedBands,
  stackedConfig,
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

type Pixel = {
  red: number;
  green: number;
  blue: number;
  alpha: number;
};

type PixelMeasure = (pixel: Pixel) => number;

const maxInRect = (
  pixels: Uint8ClampedArray,
  width: number,
  rect: PixelRect,
  measure: PixelMeasure,
): number => {
  let max = 0;
  for (let y = rect.top; y < rect.bottom; y += 1) {
    for (let x = rect.left; x < rect.right; x += 1) {
      const index = (y * width + x) * 4;
      max = Math.max(
        max,
        measure({
          red: pixels[index],
          green: pixels[index + 1],
          blue: pixels[index + 2],
          alpha: pixels[index + 3],
        }),
      );
    }
  }
  return max;
};

const redness: PixelMeasure = (pixel) => pixel.red;

const opacity: PixelMeasure = (pixel) => pixel.alpha;

const greenness: PixelMeasure = (pixel) =>
  pixel.green - Math.max(pixel.red, pixel.blue);

const maxRedClearOfCorners = (
  pixels: Uint8ClampedArray,
  config: SpectrogramConfig,
): number => {
  const { width, height } = config.viewSize;
  return maxInRect(
    pixels,
    width,
    {
      left: stackedLaneRadius,
      right: width - stackedLaneRadius,
      top: 0,
      bottom: height,
    },
    redness,
  );
};

describe('spectrogram processor', () => {
  it('draws the lead across the whole width below the recording, clear between', async () => {
    const config = stackedConfig();
    await withProcessor({ device, config }, async (processor) => {
      const length = config.sampleRate * 5;
      const lead = createTone(length, toneFrequency, config.sampleRate);
      const recording = createSilence(length);
      await processor.render({ lead, recording }, 0.5);
      const pixels = await readCanvas(config.canvas);
      const { width, height } = config.viewSize;
      const bands = stackedBands(height);
      const playhead = Math.floor(config.playheadRatio * width);
      expect(
        maxInRect(
          pixels,
          width,
          {
            left: 0,
            right: playhead - 1,
            top: bands.leadTop,
            bottom: height,
          },
          redness,
        ),
      ).toBeGreaterThan(40);
      expect(
        maxInRect(
          pixels,
          width,
          {
            left: stackedLaneRadius,
            right: width - stackedLaneRadius,
            top: 0,
            bottom: bands.recordingHeight,
          },
          redness,
        ),
      ).toBeLessThan(16);
      expect(
        maxInRect(
          pixels,
          width,
          {
            left: 0,
            right: width,
            top: bands.recordingHeight,
            bottom: bands.leadTop,
          },
          opacity,
        ),
      ).toBe(0);
    });
  });

  it('draws the recording in its own frequency rows above the lead', async () => {
    const config = stackedConfig();
    await withProcessor({ device, config }, async (processor) => {
      const length = config.sampleRate * 5;
      const lead = createSilence(length);
      const recording = createTone(length, toneFrequency, config.sampleRate);
      await processor.render({ lead, recording }, 0.5);
      const pixels = await readCanvas(config.canvas);
      const { width, height } = config.viewSize;
      const bands = stackedBands(height);
      expect(
        maxInRect(
          pixels,
          width,
          {
            left: stackedLaneRadius,
            right: width - stackedLaneRadius,
            top: bands.leadTop,
            bottom: height,
          },
          redness,
        ),
      ).toBeLessThan(16);

      const recordingBand = pixels.subarray(
        0,
        bands.recordingHeight * width * 4,
      );
      const expectedRow = rowAtFrequency(toneFrequency, {
        ...config,
        viewSize: { width, height: bands.recordingHeight },
      });
      const actualRow = brightestRow(
        recordingBand,
        width,
        bands.recordingHeight,
      );
      expect(Math.abs(actualRow - expectedRow)).toBeLessThan(
        bands.recordingHeight * 0.15,
      );
    });
  });

  it('draws the recording pitch over the lead in the match colour', async () => {
    const base = stackedConfig();
    const config = singleBandConfig({
      lanes: {
        ...base.lanes,
        recording: { ...base.lanes.recording, showFundamental: true },
      },
    });
    await withProcessor({ device, config }, async (processor) => {
      const length = config.sampleRate * 5;
      const samples = {
        lead: createTone(length, toneFrequency, config.sampleRate),
        recording: createTone(length, toneFrequency, config.sampleRate),
      };
      await processor.render(samples, 0.5);
      while (processor.hasPendingWork()) {
        await processor.render(samples, 0.5);
      }
      const pixels = await readCanvas(config.canvas);
      const { width, height } = config.viewSize;
      const bands = stackedBands(height);
      expect(
        maxInRect(
          pixels,
          width,
          { left: 0, right: width, top: bands.leadTop, bottom: height },
          greenness,
        ),
      ).toBeGreaterThan(40);
      expect(
        maxInRect(
          pixels,
          width,
          { left: 0, right: width, top: 0, bottom: bands.recordingHeight },
          greenness,
        ),
      ).toBeLessThan(16);
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
      expect(maxRedClearOfCorners(pixels, config)).toBeLessThan(16);
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
      expect(maxRedClearOfCorners(silent, config)).toBeLessThan(16);

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
      expect(maxRedClearOfCorners(silent, config)).toBeLessThan(16);

      const invalidation = writeCentreTone(lead, config.sampleRate);
      processor.updateConfig({
        colors: {
          ...config.colors,
          foreground: '#ff0000',
        },
      });
      await processor.render({ lead }, 0.5);
      const stale = await readCanvas(config.canvas);
      expect(maxRedClearOfCorners(stale, config)).toBeLessThan(16);

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
