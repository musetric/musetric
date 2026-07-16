const minBeats = 2;
const minIntervalsForIqr = 4;
const defaultMeter = 4;

const percentile = (sorted: number[], ratio: number): number => {
  const position = ratio * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) {
    return sorted[lower];
  }
  return sorted[lower] + (position - lower) * (sorted[upper] - sorted[lower]);
};

const median = (values: number[]): number =>
  percentile(
    [...values].sort((a, b) => a - b),
    0.5,
  );

const roundHalfToEven = (value: number): number => {
  const floor = Math.floor(value);
  if (value - floor !== 0.5) {
    return Math.round(value);
  }
  return floor % 2 === 0 ? floor : floor + 1;
};

const differences = (values: number[]): number[] =>
  values.slice(1).map((value, index) => value - values[index]);

const withoutOutliers = (intervals: number[]): number[] => {
  const sorted = [...intervals].sort((a, b) => a - b);
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  const iqr = q3 - q1;
  const low = q1 - 1.5 * iqr;
  const high = q3 + 1.5 * iqr;
  const filtered = intervals.filter(
    (interval) => interval >= low && interval <= high,
  );
  return filtered.length > 0 ? filtered : intervals;
};

export const estimateBpm = (beats: number[]): number => {
  if (beats.length < minBeats) {
    return 0;
  }
  const intervals = differences(beats);
  const kept =
    intervals.length >= minIntervalsForIqr
      ? withoutOutliers(intervals)
      : intervals;
  const interval = median(kept);
  if (interval <= 0) {
    return 0;
  }
  return 60 / interval;
};

export const estimateMeter = (beats: number[], downbeats: number[]): number => {
  if (downbeats.length < minBeats || beats.length < minBeats) {
    return defaultMeter;
  }
  const epsilon = 1e-3;
  const counts: number[] = [];
  for (let i = 0; i < downbeats.length - 1; i += 1) {
    const start = downbeats[i] - epsilon;
    const end = downbeats[i + 1] - epsilon;
    const inBar = beats.filter((beat) => beat >= start && beat < end).length;
    if (inBar > 0) {
      counts.push(inBar);
    }
  }
  if (counts.length === 0) {
    return defaultMeter;
  }
  return roundHalfToEven(median(counts));
};
