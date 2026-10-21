export const getPercentile = (
  values: readonly number[],
  percent: number,
): number => {
  if (values.length === 0) {
    return Number.NaN;
  }
  const sorted = values.toSorted((a, b) => a - b);
  const position = ((sorted.length - 1) * percent) / 100;
  const lower = Math.floor(position);
  const upper = Math.min(sorted.length - 1, lower + 1);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
};

export const getMedian = (values: readonly number[]): number =>
  getPercentile(values, 50);

export const getMaximum = (values: ArrayLike<number>): number => {
  let maximum = -Infinity;
  for (let index = 0; index < values.length; index += 1) {
    maximum = Math.max(maximum, values[index]);
  }
  return maximum;
};

export type Spread = {
  count: number;
  median: number;
  p10: number;
  p90: number;
  min: number;
  max: number;
};

export const getSpread = (values: readonly number[]): Spread => ({
  count: values.length,
  median: getMedian(values),
  p10: getPercentile(values, 10),
  p90: getPercentile(values, 90),
  min: -getMaximum(values.map((value) => -value)),
  max: getMaximum(values),
});

export const getRms = (samples: ArrayLike<number>): number => {
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    sum += samples[index] * samples[index];
  }
  return Math.sqrt(sum / samples.length);
};

export const toDecibels = (value: number): number => 20 * Math.log10(value);

export const getPeak = (samples: ArrayLike<number>): number => {
  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) {
    peak = Math.max(peak, Math.abs(samples[index]));
  }
  return peak;
};
