import { describe, expect, it } from 'vitest';
import {
  stackedLaneGap,
  stackedLaneRadius,
} from '../common/stackedLanes.es.js';
import { type SpectrogramConfig } from '../config.cross.js';
import { defaultSpectrogramConfig } from '../defaultConfig.cross.js';
import { type SpectrogramProcessor } from '../processor.js';
import { readCanvas, rowAtFrequency } from './common.js';
import {
  device,
  singleBandConfig,
  withProcessor,
} from './processor.fixtures.js';

const fundamental = 220;

const createHarmonicTone = (
  length: number,
  sampleRate: number,
  amplitudes: number[],
) =>
  Float32Array.from({ length }, (_, index) =>
    amplitudes.reduce(
      (sum, amplitude, harmonic) =>
        sum +
        amplitude *
          Math.sin(
            (2 * Math.PI * fundamental * (harmonic + 1) * index) / sampleRate,
          ),
      0,
    ),
  );

type PixelMeasure = (red: number, blue: number) => number;

const blueness: PixelMeasure = (red, blue) => blue - red;

const redness: PixelMeasure = (red, blue) => red - blue;

const maxInRow = (
  pixels: Uint8ClampedArray,
  width: number,
  centerRow: number,
  measure: PixelMeasure,
): number => {
  let max = 0;
  for (let y = Math.round(centerRow) - 2; y <= Math.round(centerRow) + 2; y++) {
    for (let x = stackedLaneRadius; x < width - stackedLaneRadius; x++) {
      const index = (y * width + x) * 4;
      max = Math.max(max, measure(pixels[index], pixels[index + 2]));
    }
  }
  return max;
};

const takeRowAtFrequency = (frequency: number, config: SpectrogramConfig) => {
  const { height } = config.viewSize;
  const takeHeight = Math.floor((height - stackedLaneGap) / 2);
  return rowAtFrequency(frequency, {
    ...config,
    viewSize: { ...config.viewSize, height: takeHeight },
  });
};

const settle = async (
  processor: SpectrogramProcessor,
  samples: Parameters<SpectrogramProcessor['render']>[0],
) => {
  await processor.render(samples, 0.5);
  while (processor.hasPendingWork()) {
    await processor.render(samples, 0.5);
  }
};

describe('spectrogram harmonics', () => {
  it('marks the loudest harmonic below the limit', async () => {
    const base = singleBandConfig();
    const config = singleBandConfig({
      lanes: {
        ...base.lanes,
        lead: { ...base.lanes.lead, showFundamental: true },
      },
      harmonics: { ...defaultSpectrogramConfig.harmonics, enabled: true },
    });
    await withProcessor({ device, config }, async (processor) => {
      const length = config.sampleRate * 5;
      await settle(processor, {
        lead: createHarmonicTone(length, config.sampleRate, [0.5, 1, 0.4]),
      });

      const cursor = await processor.readCursorHarmonics();
      expect(cursor?.lead.dominant).toBe(2);
      expect(cursor?.lead.fundamental).toBeGreaterThan(fundamental * 0.97);
      expect(cursor?.lead.fundamental).toBeLessThan(fundamental * 1.03);

      const pixels = await readCanvas(config.canvas);
      const { width } = config.viewSize;
      const second = rowAtFrequency(fundamental * 2, config);
      const first = rowAtFrequency(fundamental, config);
      expect(maxInRow(pixels, width, second, blueness)).toBeGreaterThan(40);
      expect(maxInRow(pixels, width, first, blueness)).toBeLessThan(16);
    });
  });

  it('colours the take harmonics by their level against the lead', async () => {
    const base = singleBandConfig();
    const config = singleBandConfig({
      lanes: {
        lead: { ...base.lanes.lead, showSpectrogram: true },
        recording: {
          ...base.lanes.recording,
          showSpectrogram: true,
          showFundamental: true,
        },
      },
      harmonicComparison: {
        ...defaultSpectrogramConfig.harmonicComparison,
        enabled: true,
      },
    });
    await withProcessor({ device, config }, async (processor) => {
      const length = config.sampleRate * 5;
      await settle(processor, {
        lead: createHarmonicTone(length, config.sampleRate, [0.5, 1, 0.4]),
        recording: createHarmonicTone(length, config.sampleRate, [1, 0.3, 0.4]),
      });

      const pixels = await readCanvas(config.canvas);
      const { width } = config.viewSize;
      const first = takeRowAtFrequency(fundamental, config);
      const second = takeRowAtFrequency(fundamental * 2, config);
      expect(maxInRow(pixels, width, first, redness)).toBeGreaterThan(40);
      expect(maxInRow(pixels, width, first, blueness)).toBeLessThan(16);
      expect(maxInRow(pixels, width, second, blueness)).toBeGreaterThan(40);
      expect(maxInRow(pixels, width, second, redness)).toBeLessThan(16);
    });
  });

  it('draws the singer stencil on the empty take band', async () => {
    const base = singleBandConfig();
    const stencilConfig = (opacity: number) =>
      singleBandConfig({
        lanes: {
          lead: { ...base.lanes.lead, showSpectrogram: true },
          recording: {
            ...base.lanes.recording,
            showSpectrogram: true,
            showFundamental: true,
          },
        },
        stencil: {
          ...defaultSpectrogramConfig.stencil,
          enabled: true,
          opacity,
        },
      });
    const measure = async (opacity: number) => {
      const config = stencilConfig(opacity);
      return withProcessor({ device, config }, async (processor) => {
        const length = config.sampleRate * 5;
        await settle(processor, {
          lead: createHarmonicTone(length, config.sampleRate, [1, 0.6, 0.4]),
          recording: new Float32Array(length),
        });
        const pixels = await readCanvas(config.canvas);
        const { width } = config.viewSize;
        return {
          first: maxInRow(
            pixels,
            width,
            takeRowAtFrequency(fundamental, config),
            blueness,
          ),
          third: maxInRow(
            pixels,
            width,
            takeRowAtFrequency(fundamental * 3, config),
            blueness,
          ),
          between: maxInRow(
            pixels,
            width,
            takeRowAtFrequency(fundamental * 1.5, config),
            blueness,
          ),
        };
      });
    };
    const shown = await measure(1);
    expect(shown.first).toBeGreaterThan(60);
    expect(shown.third).toBeGreaterThan(20);
    expect(shown.between).toBeLessThan(16);
    const hidden = await measure(0);
    expect(hidden.first).toBeLessThan(16);
  });
});
