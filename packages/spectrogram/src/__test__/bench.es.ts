import {
  type BenchStatsConfig,
  defaultBenchStatsConfig,
} from '@musetric/utils';

export const spectrogramBenchConfig: BenchStatsConfig = {
  ...defaultBenchStatsConfig,
  batchSize: 16,
  maxTries: 12,
  stableSampleWindow: 48,
  stableCvPercent: 5,
  targetSampleMs: 20,
  maxRunsPerSample: 8,
  trimFraction: 0.15,
};
export const benchBatchSize = spectrogramBenchConfig.batchSize;
export const benchMaxTries = spectrogramBenchConfig.maxTries;
export const benchStableCvPercent = spectrogramBenchConfig.stableCvPercent;
export const benchStableSampleWindow =
  spectrogramBenchConfig.stableSampleWindow;
export const warmupIters = 32;
export const benchMinMeanMsForCv = 0.01;

export type BenchBand = {
  label: string;
  windowSize: number;
  minFrequency: number;
  fullMinFrequency: number;
  fullMaxFrequency: number;
  maxFrequency: number;
};

export type SpectrogramBenchPreset = {
  label: string;
  width: number;
  height: number;
  windowSize: number;
  bandCount: 1 | 3;
};

export type SpectrogramBenchScenarioKind = 'full' | 'playback' | 'recording';

export type SpectrogramBenchScenario = {
  label: string;
  kind: SpectrogramBenchScenarioKind;
  sampleSeconds: number;
  framesPerRender: number;
  invalidatedFrames: number;
  invalidatedChunkCount?: number;
  invalidatedChunkGapFrames?: number;
  coalesceInvalidations?: boolean;
};

export type SpectrogramBenchCase = SpectrogramBenchPreset & {
  scenario: SpectrogramBenchScenario;
};

export const fullMount: SpectrogramBenchScenario = {
  label: 'full-mount',
  kind: 'full',
  sampleSeconds: 260,
  framesPerRender: 0,
  invalidatedFrames: 0,
};

export const playback60Fps: SpectrogramBenchScenario = {
  label: 'playback-60fps',
  kind: 'playback',
  sampleSeconds: 260,
  framesPerRender: 735,
  invalidatedFrames: 0,
};

export const playback30Fps: SpectrogramBenchScenario = {
  label: 'playback-30fps',
  kind: 'playback',
  sampleSeconds: 260,
  framesPerRender: 1470,
  invalidatedFrames: 0,
};

export const recording60Fps: SpectrogramBenchScenario = {
  label: 'recording-60fps',
  kind: 'recording',
  sampleSeconds: 260,
  framesPerRender: 735,
  invalidatedFrames: 735,
};

export const recording30Fps: SpectrogramBenchScenario = {
  label: 'recording-30fps',
  kind: 'recording',
  sampleSeconds: 260,
  framesPerRender: 1470,
  invalidatedFrames: 1470,
};

export const createBenchBands = (
  windowSize: number,
  bandCount: 1 | 3,
): BenchBand[] => {
  if (bandCount === 1) {
    return [
      {
        label: `${windowSize}`,
        windowSize,
        minFrequency: 20,
        fullMinFrequency: 20,
        fullMaxFrequency: 20_000,
        maxFrequency: 20_000,
      },
    ];
  }
  const half = windowSize / 2;
  const quarter = windowSize / 4;
  return [
    {
      label: `${windowSize}`,
      windowSize,
      minFrequency: 20,
      fullMinFrequency: 20,
      fullMaxFrequency: 300,
      maxFrequency: 900,
    },
    {
      label: `${half}`,
      windowSize: half,
      minFrequency: 300,
      fullMinFrequency: 900,
      fullMaxFrequency: 2200,
      maxFrequency: 4200,
    },
    {
      label: `${quarter}`,
      windowSize: quarter,
      minFrequency: 2200,
      fullMinFrequency: 4200,
      fullMaxFrequency: 20_000,
      maxFrequency: 20_000,
    },
  ];
};

export type SpectrogramBenchMetric = {
  label: string;
  mean: number;
  cv: number;
};

export type SpectrogramBenchSummary = {
  timestamp: string;
  caseLabel: string;
  preset: string;
  scenario: string;
  windowSize: number;
  bandCount: number;
  sampleSeconds: number;
  framesPerRender: number;
  invalidatedFrames: number;
  metrics: SpectrogramBenchMetric[];
  sampleCount: number;
};

export const benchStageOrder = [
  'sliceSamples',
  'fourierTransform',
  'magnitudify',
  'decibelify',
  'fundamentalFrequency',
  'remap',
  'draw',
  'gpuCompute',
  'gpuWork',
  'configure',
  'writeBuffers',
  'createCommand',
  'submitCommand',
  'other',
  'total',
  'wall',
] as const;

const padTimestamp = (value: number): string => String(value).padStart(2, '0');

export const createBenchTimestamp = (value: Date = new Date()): string =>
  `${value.getFullYear()}${padTimestamp(value.getMonth() + 1)}${padTimestamp(value.getDate())}T${padTimestamp(value.getHours())}${padTimestamp(value.getMinutes())}${padTimestamp(value.getSeconds())}`;

export const formatBenchTimestamp = (timestamp: string): string =>
  `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}T${timestamp.slice(9, 11)}-${timestamp.slice(11, 13)}-${timestamp.slice(13, 15)}`;

const metricMap = (
  summary: SpectrogramBenchSummary,
): Map<string, SpectrogramBenchMetric> =>
  new Map(summary.metrics.map((metric) => [metric.label, metric]));

export const formatBenchMarkdown = (
  summaries: SpectrogramBenchSummary[],
): string => {
  if (summaries.length < 1) {
    return '';
  }

  const headers = summaries.map((summary) => summary.scenario);
  const header = `| stage | ${headers.join(' | ')} |`;
  const separator = `| --- | ${summaries.map(() => '---').join(' | ')} |`;
  const maps = summaries.map(metricMap);
  const meanRows = [header, separator];
  const cvRows = [header, separator];

  for (const stage of benchStageOrder) {
    const meanCells: string[] = [stage];
    const cvCells: string[] = [stage];
    for (const map of maps) {
      const metric = map.get(stage);
      if (!metric || !Number.isFinite(metric.mean)) {
        meanCells.push('-');
        cvCells.push('-');
        continue;
      }
      meanCells.push(`${metric.mean.toFixed(3)}ms`);
      if (!Number.isFinite(metric.cv) || metric.mean < benchMinMeanMsForCv) {
        cvCells.push('-');
        continue;
      }
      cvCells.push(`${metric.cv.toFixed(2)}%`);
    }
    meanRows.push(`| ${meanCells.join(' | ')} |`);
    cvRows.push(`| ${cvCells.join(' | ')} |`);
  }

  return `${meanRows.join('\n')}\n\n### CV (%)\n\n${cvRows.join('\n')}\n`;
};
