const minBeats = 2;
const stepTolerance = 0.125;
const defaultMeter = 4;
const minPreferredBpm = 60;
const maxPreferredBpm = 160;

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

const mean = (values: number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

const roundHalfToEven = (value: number): number => {
  const floor = Math.floor(value);
  if (value - floor !== 0.5) {
    return Math.round(value);
  }
  return floor % 2 === 0 ? floor : floor + 1;
};

const differences = (values: number[]): number[] =>
  values.slice(1).map((value, index) => value - values[index]);

const estimateBpm = (beats: number[]): number => {
  if (beats.length < minBeats) {
    return 0;
  }
  const intervals = differences(beats);
  const step = median(intervals);
  if (step <= 0) {
    return 0;
  }
  const nearStep = intervals.filter(
    (interval) => Math.abs(interval / step - 1) < stepTolerance,
  );
  return 60 / mean(nearStep);
};

const mapProbeBpm = (bpm: number): number => {
  if (bpm >= minPreferredBpm && bpm <= maxPreferredBpm) {
    return bpm;
  }
  if (bpm > maxPreferredBpm) {
    const half = bpm / 2;
    if (half >= minPreferredBpm && half <= maxPreferredBpm) {
      return half;
    }
  }
  return 0;
};

const probeCount = 5;
const probeSeconds = 60;
const minProbeSeconds = 20;

export const consecutiveProbeBpms = (
  beats: number[],
  duration: number,
): number[] => {
  if (duration < minProbeSeconds) {
    return [estimateBpm(beats)];
  }
  const length = Math.min(probeSeconds, duration);
  const bpms: number[] = [];
  for (
    let start = 0;
    start + minProbeSeconds <= duration && bpms.length < probeCount;
    start += length
  ) {
    const window: number[] = [];
    for (const time of beats) {
      if (time >= start && time < start + length) {
        window.push(time - start);
      }
    }
    bpms.push(estimateBpm(window));
  }
  return bpms;
};

const consensusBpm = (bpms: number[]): number => {
  const mapped: number[] = [];
  for (const bpm of bpms) {
    const value = mapProbeBpm(bpm);
    if (value > 0) {
      mapped.push(value);
    }
  }
  if (mapped.length === 0) {
    return 0;
  }
  const sorted = [...mapped].sort((left, right) => left - right);
  let bestStart = 0;
  let bestSize = 1;
  let start = 0;
  for (let end = 0; end < sorted.length; end += 1) {
    while (sorted[end] / sorted[start] > 1.08) {
      start += 1;
    }
    const size = end - start + 1;
    if (size > bestSize) {
      bestSize = size;
      bestStart = start;
    }
  }
  return median(sorted.slice(bestStart, bestStart + bestSize));
};

const keepFromLatestDownbeat = (
  counts: number[],
  downbeatCounts: number[],
): boolean[] => {
  let latest = 0;
  return counts.map((count) => {
    while (
      latest + 1 < downbeatCounts.length &&
      downbeatCounts[latest + 1] <= count
    ) {
      latest += 1;
    }
    return (count - downbeatCounts[latest]) % 2 === 0;
  });
};

const keepOnDownbeatParity = (
  counts: number[],
  downbeatCounts: number[],
): boolean[] => {
  const even = downbeatCounts.filter((count) => count % 2 === 0).length;
  const odd = downbeatCounts.length - even;
  const parity = even === odd ? downbeatCounts[0] % 2 : Number(odd > even);
  return counts.map((count) => count % 2 === parity);
};

const everyOtherBeat = (beats: number[], downbeats: number[]): number[] => {
  if (beats.length < minBeats) {
    return beats;
  }
  const intervals = differences(beats);
  const step = median(intervals);
  if (step <= 0) {
    return beats;
  }
  const counts = [0];
  intervals.forEach((interval, index) => {
    counts.push(counts[index] + Math.round(interval / step));
  });
  const downbeatCounts =
    downbeats.length > 0
      ? downbeats.map((time) => counts[beats.indexOf(time)])
      : [0];
  const bars = differences(downbeatCounts);
  const keep =
    bars.length === 0 || roundHalfToEven(median(bars)) % 2 === 0
      ? keepFromLatestDownbeat(counts, downbeatCounts)
      : keepOnDownbeatParity(counts, downbeatCounts);
  const kept = beats.filter((_, index) => keep[index]);
  return kept.length >= minBeats ? kept : beats;
};

const estimateMeter = (beats: number[], downbeats: number[]): number => {
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

type ListeningTempo = {
  bpm: number;
  beats: number[];
  downbeats: number[];
  meter: number;
};

export const summarizeRhythm = (
  beats: number[],
  downbeats: number[],
  probeBpms: number[],
): ListeningTempo => {
  const bpm = consensusBpm(
    probeBpms.length > 0 ? probeBpms : [estimateBpm(beats)],
  );
  const rawBpm = estimateBpm(beats);
  if (bpm <= 0 || rawBpm <= 0 || rawBpm / bpm < 1.5) {
    return {
      bpm,
      beats,
      downbeats,
      meter: estimateMeter(beats, downbeats),
    };
  }
  const foldedBeats = everyOtherBeat(beats, downbeats);
  const foldedDownbeats: number[] = [];
  for (const time of downbeats) {
    if (foldedBeats.includes(time)) {
      foldedDownbeats.push(time);
    }
  }
  return {
    bpm,
    beats: foldedBeats,
    downbeats: foldedDownbeats,
    meter: estimateMeter(foldedBeats, foldedDownbeats),
  };
};
