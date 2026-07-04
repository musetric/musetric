import { type SpectrogramSampleRange } from '../common/extConfig.js';
import { type SpectrogramConfig } from '../config.cross.js';
import { defaultSpectrogramConfig } from '../defaultConfig.cross.js';
import { type SpectrogramProcessor } from '../processor.js';
import {
  createBenchBands,
  type SpectrogramBenchCase,
  warmupIters,
} from './bench.es.js';
import { buildConfig, createTone } from './common.js';

export const buildPresetConfig = (
  benchCase: SpectrogramBenchCase,
): SpectrogramConfig =>
  buildConfig({
    windowSize: benchCase.windowSize,
    zeroPaddingFactor: 2,
    spectralBands: createBenchBands(benchCase.windowSize, benchCase.bandCount),
    viewSize: { width: benchCase.width, height: benchCase.height },
    lanes: {
      lead: {
        ...defaultSpectrogramConfig.lanes.lead,
        showSpectrogram: true,
        showFundamental: true,
      },
      recording: {
        ...defaultSpectrogramConfig.lanes.recording,
        showSpectrogram: false,
        showFundamental: true,
      },
    },
  });

export type WriteRecordingChunkOptions = {
  samples: Float32Array;
  frameIndex: number;
  frameCount: number;
  sampleRate: number;
  renderIndex: number;
};

export const writeRecordingChunk = (
  options: WriteRecordingChunkOptions,
): number => {
  const { samples, frameIndex, frameCount, sampleRate, renderIndex } = options;
  const start = Math.max(0, Math.min(samples.length, frameIndex));
  const end = Math.max(start, Math.min(samples.length, start + frameCount));
  const phase = renderIndex * 0.13;
  for (let index = start; index < end; index += 1) {
    samples[index] = Math.sin(
      phase + (2 * Math.PI * 440 * (index - start)) / sampleRate,
    );
  }
  return end - start;
};

export const createRecordingInvalidations = (
  scenario: SpectrogramBenchCase['scenario'],
  frameIndex: number,
): SpectrogramSampleRange[] => {
  const chunkCount = scenario.invalidatedChunkCount ?? 1;
  const gap = scenario.invalidatedChunkGapFrames ?? scenario.invalidatedFrames;
  return Array.from({ length: chunkCount }, (_, index) => ({
    frameIndex: Math.max(0, frameIndex - index * gap),
    frameCount: scenario.invalidatedFrames,
  }));
};

export const coalesceInvalidations = (
  invalidations: readonly SpectrogramSampleRange[],
): SpectrogramSampleRange[] => {
  const sorted = [...invalidations].sort((a, b) => a.frameIndex - b.frameIndex);
  const merged: SpectrogramSampleRange[] = [];
  for (const invalidation of sorted) {
    if (invalidation.frameCount <= 0) {
      continue;
    }
    const nextStart = invalidation.frameIndex;
    const nextEnd = invalidation.frameIndex + invalidation.frameCount;
    if (merged.length > 0) {
      const previous = merged[merged.length - 1];
      const previousEnd = previous.frameIndex + previous.frameCount;
      if (nextStart <= previousEnd) {
        previous.frameCount =
          Math.max(previousEnd, nextEnd) - previous.frameIndex;
        continue;
      }
    }
    merged.push({ ...invalidation });
  }
  return merged;
};

export const toRenderInvalidations = (
  scenario: SpectrogramBenchCase['scenario'],
  invalidations: readonly SpectrogramSampleRange[],
): SpectrogramSampleRange[] =>
  scenario.coalesceInvalidations
    ? coalesceInvalidations(invalidations)
    : [...invalidations];

export type BenchDriver = {
  config: SpectrogramConfig;
  prime: (processor: SpectrogramProcessor) => Promise<void>;
  render: (processor: SpectrogramProcessor) => Promise<void>;
};

export const renderDriverSamples = async (
  driver: BenchDriver,
  processor: SpectrogramProcessor,
  count: number,
): Promise<void> => {
  for (let j = 0; j < count; j += 1) {
    await driver.render(processor);
  }
};

export const createDriver = (benchCase: SpectrogramBenchCase): BenchDriver => {
  const config = buildPresetConfig(benchCase);
  const { scenario } = benchCase;
  const sampleCount = Math.round(config.sampleRate * scenario.sampleSeconds);
  const lead = createTone(sampleCount, 1000, config.sampleRate, 0.8);
  const recording = createTone(sampleCount, 440, config.sampleRate, 0.55);
  const samples = { lead, recording };
  const { framesPerRender } = scenario;
  const progressStep = framesPerRender / sampleCount;
  const progressStart = 0.2;

  let progress = progressStart;
  let renderIndex = 0;

  const prime = async (processor: SpectrogramProcessor): Promise<void> => {
    await processor.render(samples, progress);
  };

  const render = async (processor: SpectrogramProcessor): Promise<void> => {
    renderIndex += 1;

    if (scenario.kind === 'full') {
      await processor.render(
        { lead: lead.subarray(0), recording: recording.subarray(0) },
        progress,
      );
      return;
    }

    if (scenario.kind === 'recording') {
      progress += progressStep;
      const frameIndex = Math.round(progress * sampleCount);
      const chunks = createRecordingInvalidations(scenario, frameIndex);
      const writtenChunks = chunks
        .map((invalidation, invalidationIndex) => ({
          frameIndex: invalidation.frameIndex,
          frameCount: writeRecordingChunk({
            samples: recording,
            frameIndex: invalidation.frameIndex,
            frameCount: invalidation.frameCount,
            sampleRate: config.sampleRate,
            renderIndex: renderIndex + invalidationIndex,
          }),
        }))
        .filter((invalidation) => invalidation.frameCount > 0);
      const renderInvalidations = toRenderInvalidations(
        scenario,
        writtenChunks,
      );
      processor.invalidateSamples(
        renderInvalidations.map((invalidation) => ({
          trackKey: 'recording',
          frameIndex: invalidation.frameIndex,
          frameCount: invalidation.frameCount,
        })),
      );
      await processor.render(samples, progress);
      return;
    }

    progress += progressStep;
    await processor.render(samples, progress);
  };

  return {
    config,
    prime,
    render,
  };
};

export const warmup = async (
  driver: BenchDriver,
  processor: SpectrogramProcessor,
): Promise<void> => {
  await driver.prime(processor);
  for (let i = 0; i < warmupIters; i += 1) {
    await driver.render(processor);
  }
};
