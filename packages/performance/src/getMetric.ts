import { type MetricsData } from './runBenchmarks.js';

export const toPercent = (value: number, total: number) =>
  (value / total) * 100;

export type GetMetricOptions = {
  data: MetricsData | undefined;
  metrics: string[];
  showFirst: boolean;
  showPercent: boolean;
  showDeviations: boolean;
};

export const getMetric = (
  options: GetMetricOptions,
): string | number | undefined => {
  const { data, metrics, showFirst, showPercent, showDeviations } = options;
  if (!data) return undefined;

  if (showDeviations) {
    let positive = 0;
    let negative = 0;
    for (const metric of metrics) {
      const deviation = data.maxDeviation[metric];
      positive += deviation.positive;
      negative += deviation.negative;
    }
    const positiveValue = showPercent
      ? toPercent(positive, data.average.total)
      : positive;
    const negativeValue = showPercent
      ? toPercent(negative, data.average.total)
      : negative;
    return `+${positiveValue.toFixed(2)} / -${negativeValue.toFixed(2)}`;
  }

  const source = showFirst ? data.first : data.average;
  let value = 0;
  for (const metric of metrics) {
    value += source[metric];
  }
  const { total } = source;
  return showPercent ? toPercent(value, total) : value;
};
