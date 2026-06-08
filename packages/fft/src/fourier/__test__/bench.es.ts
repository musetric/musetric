import { allFourierModes, type FourierMode } from '../config.es.js';
import { formatRadixStages } from './formatRadixStages.es.js';
import { createWindowSizes } from './windowSizes.es.js';

export type FourierBenchMode = 'cufft' | FourierMode;

export type FourierBenchSummary = {
  timestamp: string;
  count: number;
  mode: FourierBenchMode;
  modeLabel: string;
  windowSizes: number[];
  means: number[];
  cvs: number[];
  sampleCount: number;
};

export const benchBatchSize = 32;

export const benchMaxTries = 10;

export const benchStableCvPercent = 5;

export const benchTargetSampleMs = 1;

export const benchMaxRunsPerSample = 128;

export const benchStableSampleWindow = benchBatchSize * 3;

const benchTrimFraction = 0.1;

export type FourierBenchConfig = {
  windowSizes: number[];
  windowCounts: readonly number[];
};

export const benchWindowSizes = createWindowSizes(1024, 8192);

export const benchWindowCounts: readonly number[] = [512, 1920];

export const benchConfig: FourierBenchConfig = {
  windowSizes: benchWindowSizes,
  windowCounts: benchWindowCounts,
};

export const computeMean = (values: readonly number[]): number =>
  values.reduce((sum, v) => sum + v, 0) / values.length;

const collectFiniteSamples = (values: readonly number[]): number[] =>
  values.filter((value) => Number.isFinite(value) && value >= 0);

export const computeMedian = (values: readonly number[]): number => {
  const samples = collectFiniteSamples(values).sort(
    (left, right) => left - right,
  );

  if (samples.length === 0) {
    return Number.NaN;
  }

  const middle = Math.floor(samples.length / 2);

  if (samples.length % 2 === 1) {
    return samples[middle];
  }

  return (samples[middle - 1] + samples[middle]) / 2;
};

export const computeCvPercent = (values: readonly number[]): number => {
  if (values.length < 2) {
    return 0;
  }

  const mean = computeMean(values);

  if (mean === 0) {
    return 0;
  }

  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);

  return (Math.sqrt(variance) / mean) * 100;
};

export const selectBenchRunsPerSample = (
  durations: readonly number[],
): number => {
  const samples = collectFiniteSamples(durations);
  const positiveSamples = samples.filter((value) => value > 0);

  if (samples.length > 0 && positiveSamples.length === 0) {
    return benchMaxRunsPerSample;
  }

  const median = computeMedian(positiveSamples);

  if (!Number.isFinite(median) || median <= 0) {
    return 1;
  }

  return Math.max(
    1,
    Math.min(benchMaxRunsPerSample, Math.ceil(benchTargetSampleMs / median)),
  );
};

const collectStableSamples = (values: readonly number[]): number[] => {
  const window = collectFiniteSamples(values).slice(-benchStableSampleWindow);

  if (window.length < 4) {
    return window;
  }

  const trimCount = Math.min(
    Math.floor(window.length * benchTrimFraction),
    Math.floor((window.length - 2) / 2),
  );

  if (trimCount === 0) {
    return window;
  }

  return [...window]
    .sort((left, right) => left - right)
    .slice(trimCount, window.length - trimCount);
};

export const computeBenchStats = (
  values: readonly number[],
): { mean: number; cv: number; sampleCount: number } => {
  const samples = collectStableSamples(values);

  if (samples.length === 0) {
    return { mean: Number.NaN, cv: Number.NaN, sampleCount: 0 };
  }

  return {
    mean: computeMean(samples),
    cv: computeCvPercent(samples),
    sampleCount: samples.length,
  };
};

export const fourierModeLabels: Record<FourierBenchMode, string> = {
  fftPackedFusedTiledR2c: 'FusedTiled',
  fftPackedStockhamR2c: 'Stockham',
  fftPackedTiledR2c: 'Tiled',
  fftPrunedFourStepR2c: 'FourStep',
  cufft: 'cuFFT',
};

export const benchModeOrder: FourierBenchMode[] = ['cufft', ...allFourierModes];

const padTimestamp = (value: number): string => String(value).padStart(2, '0');

export const createBenchTimestamp = (value: Date = new Date()): string =>
  `${value.getFullYear()}${padTimestamp(value.getMonth() + 1)}${padTimestamp(value.getDate())}T${padTimestamp(value.getHours())}${padTimestamp(value.getMinutes())}${padTimestamp(value.getSeconds())}`;

export const formatBenchTimestamp = (timestamp: string): string =>
  `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}T${timestamp.slice(9, 11)}-${timestamp.slice(11, 13)}-${timestamp.slice(13, 15)}`;

export const createBenchWave = (
  windowSize: number,
  windowCount: number,
): Float32Array => {
  const input = new Float32Array(windowSize * windowCount);
  const sineFrequency = Math.min(73, Math.floor(windowSize / 4));

  for (let windowIndex = 0; windowIndex < windowCount; windowIndex++) {
    const offset = windowIndex * windowSize;

    for (let sampleIndex = 0; sampleIndex < windowSize; sampleIndex++) {
      input[offset + sampleIndex] = Math.sin(
        (2 * Math.PI * sineFrequency * sampleIndex) / windowSize,
      );
    }
  }

  return input;
};

export const formatBenchMarkdown = (
  summariesByMode: Partial<Record<FourierBenchMode, FourierBenchSummary>>,
): string => {
  const summaries = benchModeOrder
    .map((mode) => summariesByMode[mode])
    .filter((summary): summary is FourierBenchSummary => summary !== undefined);
  if (summaries.length < 1) {
    return '';
  }

  const [referenceSummary] = summaries;
  const { windowSizes } = referenceSummary;
  const headerModes = summaries.map((summary) => summary.modeLabel);
  const header = `| windowSize | ${headerModes.join(' | ')} |`;
  const separator = `| --- | ${summaries.map(() => '---').join(' | ')} |`;
  const meanRows = [header, separator];
  const cvRows = [header, separator];
  const cufftSummary = summaries.find((summary) => summary.mode === 'cufft');

  for (const [index, windowSize] of windowSizes.entries()) {
    const factorization = formatRadixStages(windowSize);
    const meanCells = [factorization];
    const cvCells = [factorization];

    for (const summary of summaries) {
      const mean = summary.means[index];
      const cv = summary.cvs[index];

      if (!Number.isFinite(mean) || !Number.isFinite(cv)) {
        meanCells.push('-');
        cvCells.push('-');
        continue;
      }

      const cufftMean = cufftSummary?.means[index];
      const hasRatio =
        summary.mode !== 'cufft' &&
        typeof cufftMean === 'number' &&
        Number.isFinite(cufftMean) &&
        cufftMean > 0;

      meanCells.push(
        hasRatio
          ? `${mean.toFixed(3)}ms x${(mean / cufftMean).toFixed(2)}`
          : `${mean.toFixed(3)}ms`,
      );
      cvCells.push(`${cv.toFixed(2)}%`);
    }

    meanRows.push(`| ${meanCells.join(' | ')} |`);
    cvRows.push(`| ${cvCells.join(' | ')} |`);
  }

  return `${meanRows.join('\n')}\n\n### CV (%)\n\n${cvRows.join('\n')}\n`;
};
