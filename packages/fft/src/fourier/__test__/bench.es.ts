import {
  type BenchStats,
  computeBenchStats,
  defaultBenchStatsConfig,
  selectBenchRunsPerSample,
} from '@musetric/utils';
import {
  allFourierModes,
  allIFourierModes,
  type FourierMode,
  type IFourierMode,
} from '../config.es.js';
import { formatRadixStages } from './formatRadixStages.es.js';
import { createWindowSizes } from './windowSizes.es.js';

export type FourierBenchDirection = 'forward' | 'inverse';

export type FourierBenchMode = 'cufft' | FourierMode | IFourierMode;

export type FourierBenchSummary = {
  timestamp: string;
  direction: FourierBenchDirection;
  count: number;
  mode: FourierBenchMode;
  modeLabel: string;
  windowSizes: number[];
  means: number[];
  cvs: number[];
  sampleCount: number;
};

export type FourierBenchConfig = {
  windowSizes: number[];
  windowCounts: readonly number[];
};

export const benchWindowSizes = createWindowSizes(512, 1024 * 64);

export const benchWindowCounts: readonly number[] = [512, 1920];

export const benchConfig: FourierBenchConfig = {
  windowSizes: benchWindowSizes,
  windowCounts: benchWindowCounts,
};

export const fourierSelectRunsPerSample = (
  durations: readonly number[],
): number => selectBenchRunsPerSample(durations, defaultBenchStatsConfig);

export const fourierComputeStats = (values: readonly number[]): BenchStats =>
  computeBenchStats(values, defaultBenchStatsConfig);

export const fourierModeLabels: Record<FourierBenchMode, string> = {
  cufft: 'cuFFT',
  fftPackedStockhamR2c: 'Stockham',
  fftPackedTiledR2c: 'Tiled',
  ifftPackedStockhamC2r: 'Stockham',
};

export const benchModeOrder: FourierBenchMode[] = [
  'cufft',
  ...allFourierModes,
  ...allIFourierModes,
];

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
