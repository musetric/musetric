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
    let high = 0;
    let low = 0;
    for (const metric of metrics) {
      const spread = data.spread[metric];
      high += spread.high;
      low += spread.low;
    }
    const highValue = showPercent ? toPercent(high, data.median.total) : high;
    const lowValue = showPercent ? toPercent(low, data.median.total) : low;
    return `+${highValue.toFixed(2)} / -${lowValue.toFixed(2)}`;
  }

  const source = showFirst ? data.first : data.median;
  let value = 0;
  for (const metric of metrics) {
    value += source[metric];
  }
  const { total } = source;
  return showPercent ? toPercent(value, total) : value;
};
