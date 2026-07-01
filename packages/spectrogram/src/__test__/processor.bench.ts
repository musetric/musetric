import { describe, it } from 'vitest';
import {
  createBenchTimestamp,
  fullMount,
  playback30Fps,
  playback60Fps,
  recording30Fps,
  recording60Fps,
  type SpectrogramBenchCase,
  type SpectrogramBenchPreset,
} from './bench.es.js';
import { measureCase } from './benchRunner.js';

const hd1Band: SpectrogramBenchPreset = {
  label: 'hd-1band',
  width: 1280,
  height: 720,
  windowSize: 4096,
  bandCount: 1,
};

const hd3Band: SpectrogramBenchPreset = {
  label: 'hd-3band',
  width: 1280,
  height: 720,
  windowSize: 4096,
  bandCount: 3,
};

const hd1BandBenchCases: SpectrogramBenchCase[] = [
  { ...hd1Band, scenario: fullMount },
  { ...hd1Band, scenario: playback60Fps },
  { ...hd1Band, scenario: playback30Fps },
  { ...hd1Band, scenario: recording60Fps },
  { ...hd1Band, scenario: recording30Fps },
];

const hd3BandBenchCases: SpectrogramBenchCase[] = [
  { ...hd3Band, scenario: fullMount },
  { ...hd3Band, scenario: playback60Fps },
  { ...hd3Band, scenario: playback30Fps },
  { ...hd3Band, scenario: recording60Fps },
  { ...hd3Band, scenario: recording30Fps },
];

const benchTimestamp = createBenchTimestamp();

describe('spectrogram benchmarks', () => {
  describe('hd-1band', () => {
    for (const benchCase of hd1BandBenchCases) {
      it(`render ${benchCase.scenario.label}`, async (context) => {
        const summary = await measureCase(benchCase, benchTimestamp);
        Object.assign(context.task.meta, { bench: summary });
      });
    }
  });

  describe('hd-3band', () => {
    for (const benchCase of hd3BandBenchCases) {
      it(`render ${benchCase.scenario.label}`, async (context) => {
        const summary = await measureCase(benchCase, benchTimestamp);
        Object.assign(context.task.meta, { bench: summary });
      });
    }
  });
});
