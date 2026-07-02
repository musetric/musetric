import { describe, it } from 'vitest';
import { allFourierModes, allIFourierModes } from '../config.es.js';
import {
  benchWindowCounts,
  benchWindowSizes,
  type FourierBenchSummary,
  fourierModeLabels,
} from './bench.es.js';
import {
  benchTimestamp,
  measureOne,
  measureOneInverse,
} from './benchHarness.js';

describe('FFT benchmarks', () => {
  for (const windowCount of benchWindowCounts) {
    for (const mode of allFourierModes) {
      const modeLabel = fourierModeLabels[mode];

      it(`forward count ${windowCount} ${modeLabel}`, async (context) => {
        const { task } = context;
        const means: number[] = [];
        const cvs: number[] = [];
        const sampleCounts: number[] = [];

        for (const windowSize of benchWindowSizes) {
          const result = await measureOne(mode, windowSize, windowCount);

          if (result) {
            means.push(result.mean);
            cvs.push(result.cv);
            sampleCounts.push(result.sampleCount);
          } else {
            means.push(Number.NaN);
            cvs.push(Number.NaN);
            sampleCounts.push(0);
          }
        }

        const maxSampleCount = Math.max(...sampleCounts);

        const bench: FourierBenchSummary = {
          timestamp: benchTimestamp,
          direction: 'forward',
          count: windowCount,
          mode,
          modeLabel,
          windowSizes: benchWindowSizes,
          means,
          cvs,
          sampleCount: maxSampleCount,
        };

        Object.assign(task.meta, { bench });
      });
    }

    for (const mode of allIFourierModes) {
      const modeLabel = fourierModeLabels[mode];

      it(`inverse count ${windowCount} ${modeLabel}`, async (context) => {
        const { task } = context;
        const means: number[] = [];
        const cvs: number[] = [];
        const sampleCounts: number[] = [];

        for (const windowSize of benchWindowSizes) {
          const result = await measureOneInverse(mode, windowSize, windowCount);

          if (result) {
            means.push(result.mean);
            cvs.push(result.cv);
            sampleCounts.push(result.sampleCount);
          } else {
            means.push(Number.NaN);
            cvs.push(Number.NaN);
            sampleCounts.push(0);
          }
        }

        const maxSampleCount = Math.max(...sampleCounts);

        const bench: FourierBenchSummary = {
          timestamp: benchTimestamp,
          direction: 'inverse',
          count: windowCount,
          mode,
          modeLabel,
          windowSizes: benchWindowSizes,
          means,
          cvs,
          sampleCount: maxSampleCount,
        };

        Object.assign(task.meta, { bench });
      });
    }
  }
});
