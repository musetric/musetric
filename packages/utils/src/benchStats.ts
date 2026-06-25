export type BenchStatsConfig = {
  batchSize: number;
  maxTries: number;
  stableCvPercent: number;
  targetSampleMs: number;
  maxRunsPerSample: number;
  stableSampleWindow: number;
  trimFraction: number;
};

export const defaultBenchStatsConfig: BenchStatsConfig = {
  batchSize: 32,
  maxTries: 10,
  stableCvPercent: 5,
  targetSampleMs: 1,
  maxRunsPerSample: 128,
  stableSampleWindow: 32 * 3,
  trimFraction: 0.1,
};

export type BenchStats = {
  mean: number;
  cv: number;
  sampleCount: number;
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
  config: BenchStatsConfig = defaultBenchStatsConfig,
): number => {
  const samples = collectFiniteSamples(durations);
  const positiveSamples = samples.filter((value) => value > 0);

  if (samples.length > 0 && positiveSamples.length === 0) {
    return config.maxRunsPerSample;
  }

  const median = computeMedian(positiveSamples);

  if (!Number.isFinite(median) || median <= 0) {
    return 1;
  }

  return Math.max(
    1,
    Math.min(
      config.maxRunsPerSample,
      Math.ceil(config.targetSampleMs / median),
    ),
  );
};

const collectStableSamples = (
  values: readonly number[],
  config: BenchStatsConfig,
): number[] => {
  const window = collectFiniteSamples(values).slice(-config.stableSampleWindow);

  if (window.length < 4) {
    return window;
  }

  const trimCount = Math.min(
    Math.floor(window.length * config.trimFraction),
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
  config: BenchStatsConfig = defaultBenchStatsConfig,
): BenchStats => {
  const samples = collectStableSamples(values, config);

  if (samples.length === 0) {
    return { mean: Number.NaN, cv: Number.NaN, sampleCount: 0 };
  }

  return {
    mean: computeMean(samples),
    cv: computeCvPercent(samples),
    sampleCount: samples.length,
  };
};
