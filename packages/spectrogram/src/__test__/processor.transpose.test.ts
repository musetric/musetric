import { describe, expect, it } from 'vitest';
import { createMappedSource } from '../common/source.js';
import { type SpectrogramConfig } from '../config.cross.js';
import { createTone, readCanvas, rowAtFrequency } from './common.js';
import {
  device,
  singleBandConfig,
  toneFrequency,
  withProcessor,
} from './processor.fixtures.js';

const transposedConfig = (transposeSemitones: number): SpectrogramConfig => {
  const base = singleBandConfig();
  return singleBandConfig({
    lanes: {
      ...base.lanes,
      lead: { ...base.lanes.lead, transposeSemitones },
    },
  });
};

const brightestRowBetween = (
  pixels: Uint8ClampedArray,
  config: SpectrogramConfig,
  fromRatio: number,
  toRatio: number,
): number => {
  const { width, height } = config.viewSize;
  let bestRow = -1;
  let bestValue = -1;
  for (let y = 0; y < height; y += 1) {
    for (
      let x = Math.floor(width * fromRatio);
      x < Math.floor(width * toRatio);
      x += 1
    ) {
      const red = pixels[(y * width + x) * 4];
      if (red > bestValue) {
        bestValue = red;
        bestRow = y;
      }
    }
  }
  return bestRow;
};

describe('spectrogram processor transpose', () => {
  it('renders a tone moved by the lane key', async () => {
    const config = transposedConfig(12);
    await withProcessor({ device, config }, async (processor) => {
      const lead = createTone(
        config.sampleRate * 5,
        toneFrequency,
        config.sampleRate,
      );
      expect(await processor.render({ lead }, 0.5)).toBe(true);

      const pixels = await readCanvas(config.canvas);
      const expectedRow = rowAtFrequency(toneFrequency * 2, config);
      const actualRow = brightestRowBetween(pixels, config, 0, 1);
      expect(Math.abs(actualRow - expectedRow)).toBeLessThan(
        config.viewSize.height * 0.05,
      );
    });
  });

  it('moves each piece of a take by its distance to the lane key', async () => {
    const config = transposedConfig(12);
    const { sampleRate } = config;
    const pieceLength = 5 * sampleRate;
    const tone = createTone(pieceLength, toneFrequency, sampleRate);
    const piece = (index: number, transpose: number) => ({
      songStartFrame: index * pieceLength,
      songEndFrame: (index + 1) * pieceLength,
      rawStartFrame: 0,
      tempo: 1,
      transpose,
      getSamples: () => tone,
    });
    const take = createMappedSource(
      [piece(0, 0), piece(1, 12)],
      2 * pieceLength,
    );
    await withProcessor({ device, config }, async (processor) => {
      expect(await processor.render({ lead: take }, 0.5)).toBe(true);

      const pixels = await readCanvas(config.canvas);
      const tolerance = config.viewSize.height * 0.05;
      const sungInOriginal = brightestRowBetween(pixels, config, 0, 0.25);
      const sungAnOctaveUp = brightestRowBetween(pixels, config, 0.75, 1);
      expect(
        Math.abs(sungInOriginal - rowAtFrequency(toneFrequency * 2, config)),
      ).toBeLessThan(tolerance);
      expect(
        Math.abs(sungAnOctaveUp - rowAtFrequency(toneFrequency, config)),
      ).toBeLessThan(tolerance);
    });
  });
});
