import {
  assertDefined,
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

export type FourierBatchRangeBenchScenario = {
  readonly label: string;
  readonly rangeCount: 1 | 2 | 3;
  readonly totalDenominator: 4;
};

export const fourierBatchRangeBenchScenarios: readonly FourierBatchRangeBenchScenario[] =
  [
    { label: '1 range total 25%', rangeCount: 1, totalDenominator: 4 },
    { label: '2 ranges total 25%', rangeCount: 2, totalDenominator: 4 },
    { label: '3 ranges total 25%', rangeCount: 3, totalDenominator: 4 },
  ];

type FourierBenchRangeMode = `${FourierMode}:range${1 | 2 | 3}q`;

export const createFourierRangeBenchMode = (
  mode: FourierMode,
  scenario: FourierBatchRangeBenchScenario,
): FourierBenchRangeMode => `${mode}:range${scenario.rangeCount}q`;

export const benchWindowSizes = createWindowSizes(512, 1024 * 64);

export const benchWindowCounts: readonly number[] = [512, 1920];

type FourierBenchConfig = {
  windowSizes: number[];
  windowCounts: readonly number[];
};

export const benchConfig: FourierBenchConfig = {
  windowSizes: benchWindowSizes,
  windowCounts: benchWindowCounts,
};

export const fourierSelectRunsPerSample = (
  durations: readonly number[],
): number => selectBenchRunsPerSample(durations, defaultBenchStatsConfig);

export const fourierComputeStats = (values: readonly number[]): BenchStats =>
  computeBenchStats(values, defaultBenchStatsConfig);

const baseFourierModeLabels: Record<
  'cufft' | FourierMode | IFourierMode,
  string
> = {
  cufft: 'cuFFT',
  fftPackedStockhamR2c: 'Stockham',
  fftPackedTiledR2c: 'Tiled',
  ifftPackedStockhamC2r: 'Stockham',
};

const rangeBenchBaseModes: ReadonlyMap<string, FourierMode> = new Map(
  allFourierModes.flatMap((mode) =>
    fourierBatchRangeBenchScenarios.map((scenario): [string, FourierMode] => [
      createFourierRangeBenchMode(mode, scenario),
      mode,
    ]),
  ),
);

export type FourierBenchMode =
  | 'cufft'
  | FourierMode
  | IFourierMode
  | FourierBenchRangeMode;

const isFourierBenchRangeMode = (
  mode: FourierBenchMode,
): mode is FourierBenchRangeMode => rangeBenchBaseModes.get(mode) !== undefined;

const getFourierRangeBenchBaseMode = (
  mode: FourierBenchRangeMode,
): FourierMode =>
  assertDefined(
    rangeBenchBaseModes.get(mode),
    `Unknown Fourier range benchmark mode: ${mode}`,
  );

const createFourierModeLabels = (): Record<FourierBenchMode, string> => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const labels = { ...baseFourierModeLabels } as Record<
    FourierBenchMode,
    string
  >;

  for (const mode of allFourierModes) {
    for (const scenario of fourierBatchRangeBenchScenarios) {
      labels[createFourierRangeBenchMode(mode, scenario)] =
        `${baseFourierModeLabels[mode]} ${scenario.label}`;
    }
  }

  return labels;
};

export const fourierModeLabels: Record<FourierBenchMode, string> =
  createFourierModeLabels();

const benchModeOrder: FourierBenchMode[] = [
  'cufft',
  ...allFourierModes.flatMap((mode): FourierBenchMode[] => [
    mode,
    ...fourierBatchRangeBenchScenarios.map((scenario) =>
      createFourierRangeBenchMode(mode, scenario),
    ),
  ]),
  ...allIFourierModes,
];

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

export type FourierBenchDirection = 'forward' | 'inverse';

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
  const hasRangeSummary = summaries.some((summary) =>
    isFourierBenchRangeMode(summary.mode),
  );

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

      const referenceMean = isFourierBenchRangeMode(summary.mode)
        ? summariesByMode[getFourierRangeBenchBaseMode(summary.mode)]?.means[
            index
          ]
        : cufftSummary?.means[index];
      const hasRatio =
        summary.mode !== 'cufft' &&
        typeof referenceMean === 'number' &&
        Number.isFinite(referenceMean) &&
        referenceMean > 0;

      meanCells.push(
        hasRatio
          ? `${mean.toFixed(3)}ms x${(mean / referenceMean).toFixed(2)}`
          : `${mean.toFixed(3)}ms`,
      );
      cvCells.push(`${cv.toFixed(2)}%`);
    }

    meanRows.push(`| ${meanCells.join(' | ')} |`);
    cvRows.push(`| ${cvCells.join(' | ')} |`);
  }

  const rangeNote = hasRangeSummary
    ? '\n\nRange ratios are relative to the matching full WebGPU mode; non-range WebGPU ratios are relative to cuFFT.'
    : '';

  return `${meanRows.join('\n')}${rangeNote}\n\n### CV (%)\n\n${cvRows.join('\n')}\n`;
};
