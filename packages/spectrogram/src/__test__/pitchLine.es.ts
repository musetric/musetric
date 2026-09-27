import { alignToReference, type PitchFrame } from './pitchAccuracy.es.js';
import {
  countPhantoms,
  createPitchLine,
  findJerks,
  markJerky,
  measureOnsets,
  measureRattle,
  millisecondsOf,
  type PitchJerk,
  type PitchLine,
  pitchLineThresholds,
  type PitchRattle,
  quantile,
  runsOf,
} from './pitchLineSignals.es.js';

const lineClass = {
  none: 0,
  clean: 1,
  missing: 2,
  wrong: 3,
  jerky: 4,
  rattling: 5,
} as const;

const classify = (
  line: PitchLine,
  jerky: readonly boolean[],
  rattle: PitchRattle,
): Uint8Array =>
  Uint8Array.from(line.singing, (singing, index) => {
    if (!singing) {
      return lineClass.none;
    }
    if (!line.voiced[index]) {
      return lineClass.missing;
    }
    if (Math.abs(line.error[index]) > pitchLineThresholds.wrongCents) {
      return lineClass.wrong;
    }
    if (jerky[index]) {
      return lineClass.jerky;
    }
    return rattle.local[index] > pitchLineThresholds.rattleCents
      ? lineClass.rattling
      : lineClass.clean;
  });

const shareOf = (classes: Uint8Array, value: number, total: number): number =>
  total > 0 ? classes.filter((entry) => entry === value).length / total : 0;

const measureFastError = (line: PitchLine, rattle: PitchRattle): number => {
  let sum = 0;
  let count = 0;
  line.singing.forEach((singing, index) => {
    if (singing && rattle.usable[index]) {
      sum += rattle.fastSquared[index];
      count += 1;
    }
  });
  return count > 0 ? Math.sqrt(sum / count) : 0;
};

export type PitchLineOverview = {
  singingMinutes: number;
  cleanShare: number;
  missingShare: number;
  wrongShare: number;
  jerkyShare: number;
  rattlingShare: number;
  rattleCents: number;
  rattleP90Cents: number;
  stepsPerMinute: number;
  leapsPerMinute: number;
  holesPerMinute: number;
  longHolesPerMinute: number;
  specksPerMinute: number;
  islandsPerMinute: number;
  tailsPerMinute: number;
  onsetDelayMs: number;
  onsetDelayP90Ms: number;
  missedOnsetShare: number;
};

type PitchLineMeasures = {
  classes: Uint8Array;
  jerks: PitchJerk[];
  rattle: PitchRattle;
};

const summarize = (
  line: PitchLine,
  measures: PitchLineMeasures,
): PitchLineOverview => {
  const { classes, jerks, rattle } = measures;
  const { holeMs, longHoleMs, speckMs, leapCents } = pitchLineThresholds;
  const singingFrames = line.singing.filter(Boolean).length;
  const minutes = (singingFrames * line.hopSeconds) / 60;
  const perMinute = (count: number): number =>
    minutes > 0 ? count / minutes : 0;
  const holes = runsOf(
    line.singing.map((singing, index) => singing && !line.voiced[index]),
  ).map((run) => millisecondsOf(line, run));
  const specks = runsOf(line.voiced).filter(
    (run) => millisecondsOf(line, run) < speckMs,
  ).length;
  const phantoms = countPhantoms(line);
  const onsets = measureOnsets(line);
  const localRattle = Array.from(rattle.local).filter(
    (value, index) => line.singing[index] && Number.isFinite(value),
  );
  return {
    singingMinutes: minutes,
    cleanShare: shareOf(classes, lineClass.clean, singingFrames),
    missingShare: shareOf(classes, lineClass.missing, singingFrames),
    wrongShare: shareOf(classes, lineClass.wrong, singingFrames),
    jerkyShare: shareOf(classes, lineClass.jerky, singingFrames),
    rattlingShare: shareOf(classes, lineClass.rattling, singingFrames),
    rattleCents: measureFastError(line, rattle),
    rattleP90Cents: quantile(localRattle, 0.9),
    stepsPerMinute: perMinute(
      jerks.filter((jerk) => jerk.cents <= leapCents).length,
    ),
    leapsPerMinute: perMinute(
      jerks.filter((jerk) => jerk.cents > leapCents).length,
    ),
    holesPerMinute: perMinute(holes.filter((ms) => ms >= holeMs).length),
    longHolesPerMinute: perMinute(
      holes.filter((ms) => ms >= longHoleMs).length,
    ),
    specksPerMinute: perMinute(specks),
    islandsPerMinute: perMinute(phantoms.islands),
    tailsPerMinute: perMinute(phantoms.tails),
    onsetDelayMs: quantile(onsets.delaysMs, 0.5),
    onsetDelayP90Ms: quantile(onsets.delaysMs, 0.9),
    missedOnsetShare:
      onsets.missed / Math.max(1, onsets.missed + onsets.delaysMs.length),
  };
};

export type PitchLineWindow = {
  fromSeconds: number;
  toSeconds: number;
  singingSeconds: number;
  badShare: number;
  missingShare: number;
  wrongShare: number;
  jerkyShare: number;
  rattlingShare: number;
};

const scoreWindow = (
  line: PitchLine,
  classes: Uint8Array,
  from: number,
): PitchLineWindow | undefined => {
  const { windowSeconds, windowMinSingingSeconds } = pitchLineThresholds;
  const size = Math.round(windowSeconds / line.hopSeconds);
  const counts = [0, 0, 0, 0, 0, 0];
  for (const entry of classes.subarray(from, from + size)) {
    counts[entry] += 1;
  }
  const singing = counts.slice(1).reduce((sum, count) => sum + count, 0);
  if (singing * line.hopSeconds < windowMinSingingSeconds) {
    return undefined;
  }
  const fromSeconds = line.reference[from].time;
  return {
    fromSeconds,
    toSeconds: fromSeconds + windowSeconds,
    singingSeconds: singing * line.hopSeconds,
    badShare: 1 - counts[lineClass.clean] / singing,
    missingShare: counts[lineClass.missing] / singing,
    wrongShare: counts[lineClass.wrong] / singing,
    jerkyShare: counts[lineClass.jerky] / singing,
    rattlingShare: counts[lineClass.rattling] / singing,
  };
};

const findWorstWindows = (
  line: PitchLine,
  classes: Uint8Array,
  count: number,
): PitchLineWindow[] => {
  const { windowSeconds, windowStepSeconds } = pitchLineThresholds;
  const size = Math.round(windowSeconds / line.hopSeconds);
  const step = Math.round(windowStepSeconds / line.hopSeconds);
  const windows: PitchLineWindow[] = [];
  for (let from = 0; from + size <= classes.length; from += step) {
    const window = scoreWindow(line, classes, from);
    if (window) {
      windows.push(window);
    }
  }
  windows.sort((a, b) => b.badShare - a.badShare);
  const picked: PitchLineWindow[] = [];
  for (const window of windows) {
    const apart = picked.every(
      (other) =>
        window.toSeconds <= other.fromSeconds ||
        window.fromSeconds >= other.toSeconds,
    );
    if (apart && picked.length < count) {
      picked.push(window);
    }
  }
  return picked;
};

export type PitchLineRange = {
  fromSeconds: number;
  toSeconds: number;
  worstCount: number;
};

export type PitchLineResult = {
  overview: PitchLineOverview;
  worst: PitchLineWindow[];
};

export const comparePitchLine = (
  referenceFrames: PitchFrame[],
  oursFrames: PitchFrame[],
  range: PitchLineRange,
): PitchLineResult => {
  const reference = referenceFrames.filter(
    (frame) => frame.time >= range.fromSeconds && frame.time < range.toSeconds,
  );
  const line = createPitchLine(
    reference,
    alignToReference(reference, oursFrames),
  );
  const jerks = findJerks(line);
  const rattle = measureRattle(line);
  const classes = classify(line, markJerky(line, jerks), rattle);
  return {
    overview: summarize(line, { classes, jerks, rattle }),
    worst: findWorstWindows(line, classes, range.worstCount),
  };
};
