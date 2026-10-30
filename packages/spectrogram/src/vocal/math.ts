export const centsOf = (frequency: number): number =>
  1200 * Math.log2(frequency / 440);

export const median = (values: readonly number[]): number => {
  if (values.length === 0) {
    return Number.NaN;
  }
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

export const percentile = (values: readonly number[], share: number) => {
  if (values.length === 0) {
    return Number.NaN;
  }
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * share)];
};

export const framesOf = (hopSeconds: number, seconds: number): number =>
  Math.max(1, Math.round(seconds / hopSeconds));
