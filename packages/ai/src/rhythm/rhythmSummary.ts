const minBeats = 2;
const stepTolerance = 0.125;
const octaveTolerance = 0.17;
const minSectionIntervals = 4;
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

type OctaveSection = {
  octave: number;
  first: number;
  last: number;
};

const findOctaveSections = (
  beats: number[],
  period: number,
): OctaveSection[] => {
  const octaves = differences(beats).map((interval) => {
    const exact = Math.log2(interval / period);
    const octave = Math.round(exact);
    return Math.abs(exact - octave) < octaveTolerance ? octave : undefined;
  });
  const sections: OctaveSection[] = [];
  let first = 0;
  for (let index = 1; index <= octaves.length; index += 1) {
    if (index === octaves.length || octaves[index] !== octaves[first]) {
      const octave = octaves[first];
      if (
        (octave === -1 || octave === 1) &&
        index - first >= minSectionIntervals
      ) {
        sections.push({ octave, first, last: index });
      }
      first = index;
    }
  }
  return sections;
};

type FittedBeats = {
  beats: number[];
  sections: { start: number; end: number }[];
};

const fitSectionsToTempo = (
  beats: number[],
  downbeats: number[],
  period: number,
): FittedBeats => {
  const fitted: number[] = [];
  const sections: FittedBeats['sections'] = [];
  let next = 0;
  for (const section of findOctaveSections(beats, period)) {
    fitted.push(...beats.slice(next, section.first));
    const own = beats.slice(section.first, section.last + 1);
    const [start] = own;
    const end = own[own.length - 1];
    if (section.octave < 0) {
      const inside = downbeats.filter((time) => time >= start && time <= end);
      fitted.push(...everyOtherBeat(own, inside));
    } else {
      own.slice(1).forEach((time, index) => {
        fitted.push(own[index], (own[index] + time) / 2);
      });
      fitted.push(end);
    }
    sections.push({ start, end });
    next = section.last + 1;
  }
  fitted.push(...beats.slice(next));
  return { beats: fitted, sections };
};

const alignBarsInSections = (
  fitted: FittedBeats,
  downbeats: number[],
  meter: number,
): number[] => {
  const positions = new Map(
    fitted.beats.map((time, position) => [time, position]),
  );
  const inSection = (time: number) =>
    fitted.sections.some(
      (section) => time > section.start && time <= section.end,
    );
  const aligned: number[] = [];
  for (const time of downbeats) {
    const position = positions.get(time);
    const previous =
      aligned.length > 0
        ? positions.get(aligned[aligned.length - 1])
        : undefined;
    if (position === undefined) {
      continue;
    }
    if (!inSection(time) || previous === undefined) {
      aligned.push(time);
    } else if (position - previous >= meter) {
      if (position - previous === 2 * meter) {
        aligned.push(fitted.beats[previous + meter]);
      }
      aligned.push(time);
    }
  }
  return aligned;
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
  if (bpm <= 0 || rawBpm <= 0) {
    return {
      bpm,
      beats,
      downbeats,
      meter: estimateMeter(beats, downbeats),
    };
  }
  const halvedBeats =
    rawBpm / bpm < 1.5 ? beats : everyOtherBeat(beats, downbeats);
  const halved = new Set(halvedBeats);
  const halvedDownbeats: number[] = [];
  for (const time of downbeats) {
    if (halved.has(time)) {
      halvedDownbeats.push(time);
    }
  }
  const fitted = fitSectionsToTempo(halvedBeats, halvedDownbeats, 60 / bpm);
  const fittedDownbeats = alignBarsInSections(
    fitted,
    halvedDownbeats,
    estimateMeter(halvedBeats, halvedDownbeats),
  );
  return {
    bpm,
    beats: fitted.beats,
    downbeats: fittedDownbeats,
    meter: estimateMeter(fitted.beats, fittedDownbeats),
  };
};
