import { describe, expect, it } from 'vitest';
import { defaultSpectrogramConfig } from '../defaultConfig.cross.js';
import { buildConfig, readCanvas, rowAtFrequency } from './common.js';
import { device, withProcessor } from './processor.fixtures.js';

const sampleRate = 48000;
const songSeconds = 4;
const burstSeconds = 2;
const burstLength = Math.round(0.03 * sampleRate);
const bandFrequencies = [200, 1500, 6000];

const createBurstSong = (): Float32Array => {
  const song = new Float32Array(songSeconds * sampleRate);
  const start = burstSeconds * sampleRate - burstLength / 2;
  for (let index = 0; index < burstLength; index += 1) {
    const envelope = Math.sin((Math.PI * index) / burstLength) ** 2;
    const time = (start + index) / sampleRate;
    let value = 0;
    for (const frequency of bandFrequencies) {
      value += Math.sin(2 * Math.PI * frequency * time);
    }
    song[start + index] = (0.3 * envelope * value) / bandFrequencies.length;
  }
  return song;
};

const timingConfig = () => {
  const base = defaultSpectrogramConfig;
  return buildConfig({
    visibleTime: 1,
    playheadRatio: 0.5,
    minFrequency: 120,
    maxFrequency: 8000,
    viewSize: { width: 256, height: 128 },
    lanes: {
      lead: {
        ...base.lanes.lead,
        showSpectrogram: true,
        showFundamental: false,
      },
      recording: {
        ...base.lanes.recording,
        showSpectrogram: false,
        showFundamental: false,
      },
    },
  });
};

const brightnessCenter = (
  pixels: Uint8ClampedArray,
  width: number,
  rows: readonly number[],
): number => {
  let weight = 0;
  let moment = 0;
  for (let column = 0; column < width; column += 1) {
    const value = Math.max(
      ...rows.map((row) => pixels[(row * width + column) * 4]),
    );
    weight += value;
    moment += value * column;
  }
  return moment / weight;
};

describe('spectrogram timing', () => {
  it('draws a sound at the playhead in the playhead column in every band', async () => {
    const config = timingConfig();
    const { width } = config.viewSize;
    const lead = createBurstSong();
    const progress = (burstSeconds * sampleRate) / lead.length;
    const step = (config.visibleTime * sampleRate) / (width - 1);
    const playheadColumn = config.playheadRatio * (width - 1);
    const pixels = await withProcessor(
      { device, config },
      async (processor) => {
        const samples = { lead };
        await processor.render(samples, progress);
        while (processor.hasPendingWork()) {
          await processor.render(samples, progress);
        }
        return readCanvas(config.canvas);
      },
    );
    for (const frequency of bandFrequencies) {
      const center = Math.round(rowAtFrequency(frequency, config));
      const rows = [center - 1, center, center + 1];
      const offsetFrames =
        (brightnessCenter(pixels, width, rows) - playheadColumn) * step;
      expect(
        Math.abs(offsetFrames),
        `${frequency} Hz is ${offsetFrames} frames off the playhead`,
      ).toBeLessThan(1.5 * step);
    }
  });
});
