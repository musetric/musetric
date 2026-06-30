import { describe, it } from 'vitest';
import { allFourierModes } from '../config.es.js';
import { type FourierBatchRange } from '../types.js';
import {
  benchWindowCounts,
  benchWindowSizes,
  createFourierRangeBenchMode,
  type FourierBatchRangeBenchScenario,
  fourierBatchRangeBenchScenarios,
  type FourierBenchSummary,
  fourierModeLabels,
} from './bench.es.js';
import { benchTimestamp, measureOne } from './benchHarness.js';

const createBatchRangeBenchRanges = (
  windowCount: number,
  scenario: FourierBatchRangeBenchScenario,
): readonly FourierBatchRange[] => {
  const totalBatchCount = Math.max(
    scenario.rangeCount,
    Math.floor(windowCount / scenario.totalDenominator),
  );
  const baseBatchCount = Math.floor(totalBatchCount / scenario.rangeCount);
  const remainder = totalBatchCount % scenario.rangeCount;

  return Array.from({ length: scenario.rangeCount }, (_, index) => {
    const batchCount = baseBatchCount + (index < remainder ? 1 : 0);
    const segmentStart = Math.floor(
      (index * windowCount) / scenario.rangeCount,
    );
    const segmentEnd = Math.floor(
      ((index + 1) * windowCount) / scenario.rangeCount,
    );
    const segmentSize = segmentEnd - segmentStart;
    const batchOffset =
      segmentStart + Math.max(0, Math.floor((segmentSize - batchCount) / 2));

    return { batchOffset, batchCount };
  });
};

describe('FFT batch range benchmarks', () => {
  for (const windowCount of benchWindowCounts) {
    for (const mode of allFourierModes) {
      for (const scenario of fourierBatchRangeBenchScenarios) {
        const rangeMode = createFourierRangeBenchMode(mode, scenario);
        const rangeModeLabel = fourierModeLabels[rangeMode];

        it(`forward count ${windowCount} ${rangeModeLabel}`, async (context) => {
          const { task } = context;
          const means: number[] = [];
          const cvs: number[] = [];
          const sampleCounts: number[] = [];
          const ranges = createBatchRangeBenchRanges(windowCount, scenario);

          for (const windowSize of benchWindowSizes) {
            const result = await measureOne(mode, windowSize, windowCount, {
              logLabel: rangeModeLabel,
              ranges,
            });

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
            mode: rangeMode,
            modeLabel: rangeModeLabel,
            windowSizes: benchWindowSizes,
            means,
            cvs,
            sampleCount: maxSampleCount,
          };

          Object.assign(task.meta, { bench });
        });
      }
    }
  }
});
