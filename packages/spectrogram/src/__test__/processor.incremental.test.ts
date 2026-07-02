import { describe, expect, it } from 'vitest';
import { type SpectrogramSampleInvalidation } from '../common/sampleInvalidations.js';
import { type SpectrogramConfig } from '../config.cross.js';
import { defaultSpectrogramConfig } from '../defaultConfig.cross.js';
import {
  type SpectrogramProcessor,
  type SpectrogramSamples,
} from '../processor.js';
import { createSilence, createTone, maxRed, readCanvas } from './common.js';
import {
  device,
  expectMatchesReference,
  progressForColumns,
  renderFromScratch,
  singleBandConfig,
  toneFrequency,
  windowSize,
  withTwoProcessors,
  writeCentreTone,
  writeToneRange,
} from './processor.fixtures.js';

type IncrementalVsFullScenario = {
  incrementalConfig: SpectrogramConfig;
  fullConfig: SpectrogramConfig;
  samples: SpectrogramSamples;
  progress: number;
  driveIncremental: (processor: SpectrogramProcessor) => Promise<void>;
  assertFullBright?: boolean;
};

const assertIncrementalMatchesFull = async (
  scenario: IncrementalVsFullScenario,
): Promise<void> => {
  await withTwoProcessors(
    { device, config: scenario.incrementalConfig },
    { device, config: scenario.fullConfig },
    async (incremental, full) => {
      await scenario.driveIncremental(incremental);
      const incrementalPixels = await readCanvas(
        scenario.incrementalConfig.canvas,
      );
      const fullPixels = await renderFromScratch(
        full,
        scenario.fullConfig,
        scenario.samples,
        scenario.progress,
      );
      if (scenario.assertFullBright) {
        expect(maxRed(fullPixels)).toBeGreaterThan(40);
      }
      expectMatchesReference(incrementalPixels, fullPixels);
    },
  );
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
): SpectrogramSampleInvalidation[] => {
  const {
    recording,
    firstChunkFrameIndex,
    chunkCount,
    chunkFrameCount,
    sampleRate,
  } = options;
  const invalidated: SpectrogramSampleInvalidation[] = [];
  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const chunkFrameIndex = firstChunkFrameIndex + chunkIndex * chunkFrameCount;
    writeToneRange({
      samples: recording,
      frameIndex: chunkFrameIndex,
      frameCount: chunkFrameCount,
      frequency: 440,
      sampleRate,
    });
    invalidated.push({
      trackKey: 'recording',
      frameIndex: chunkFrameIndex,
      frameCount: chunkFrameCount,
    });
  }
  return invalidated;
};

describe('spectrogram processor incremental render', () => {
  it('matches a full render when slide and recording dirty disjoint columns', async () => {
    const incrementalConfig = singleBandConfig();
    const fullConfig = singleBandConfig();
    const length = incrementalConfig.sampleRate * 5;
    const lead = createSilence(length);
    const start = 0.5;
    const slide = progressForColumns(incrementalConfig, length, 4);
    await assertIncrementalMatchesFull({
      incrementalConfig,
      fullConfig,
      samples: { lead },
      progress: start + slide,
      assertFullBright: true,
      driveIncremental: async (incremental) => {
        await incremental.render({ lead }, start);
        const invalidation = writeCentreTone(
          lead,
          incrementalConfig.sampleRate,
        );
        incremental.invalidateSamples([invalidation]);
        await incremental.render({ lead }, start + slide);
      },
    });
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

    await assertIncrementalMatchesFull({
      incrementalConfig,
      fullConfig,
      samples: { lead, recording },
      progress: start + slide,
      driveIncremental: async (incremental) => {
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
      },
    });
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
    const length = incrementalConfig.sampleRate * 5;
    const lead = createTone(
      length,
      toneFrequency,
      incrementalConfig.sampleRate,
    );

    await assertIncrementalMatchesFull({
      incrementalConfig,
      fullConfig,
      samples: { lead },
      progress: 0.5,
      driveIncremental: async (incremental) => {
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
        incremental.invalidateSamples([
          {
            trackKey: 'lead',
            frameIndex: chunkStart,
            frameCount: chunkLength,
          },
        ]);
        await incremental.render({ lead }, 0.5);
      },
    });
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
    const lead = createTone(
      incrementalConfig.sampleRate * 5,
      toneFrequency,
      incrementalConfig.sampleRate,
    );
    await assertIncrementalMatchesFull({
      incrementalConfig,
      fullConfig,
      samples: { lead },
      progress: 0.5,
      assertFullBright: true,
      driveIncremental: async (incremental) => {
        await incremental.render({ lead }, 0.5);
        incremental.updateConfig({ lanes: gainedLanes });
        await incremental.render({ lead }, 0.5);
      },
    });
  });
});
