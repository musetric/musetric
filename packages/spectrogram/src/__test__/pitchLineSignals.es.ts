import { centsBetween, type PitchFrame } from './pitchAccuracy.es.js';

export const pitchLineThresholds = {
  wrongCents: 50,
  stepCents: 50,
  stillCents: 25,
  stepLagMs: 10,
  leapCents: 300,
  jerkyHaloMs: 25,
  rattleCents: 10,
  rattleSmoothMs: 50,
  rattleWindowMs: 100,
  rattleOutlierCents: 100,
  rattleMinFrames: 5,
  holeMs: 30,
  longHoleMs: 150,
  speckMs: 50,
  phantomMs: 30,
  onsetGapMs: 100,
  onsetSearchMs: 300,
  windowSeconds: 5,
  windowStepSeconds: 1,
  windowMinSingingSeconds: 1.5,
};

export type PitchLine = {
  reference: PitchFrame[];
  ours: Float64Array;
  hopSeconds: number;
  singing: boolean[];
  voiced: boolean[];
  error: Float64Array;
};

export const createPitchLine = (
  reference: PitchFrame[],
  ours: Float64Array,
): PitchLine => {
  const hopSeconds =
    reference.length > 1 ? reference[1].time - reference[0].time : 0;
  const error = new Float64Array(reference.length).fill(NaN);
  reference.forEach((frame, index) => {
    if (frame.f0 > 0 && ours[index] > 0) {
      error[index] = centsBetween(ours[index], frame.f0);
    }
  });
  return {
    reference,
    ours,
    hopSeconds,
    singing: reference.map((frame) => frame.trusted && frame.f0 > 0),
    voiced: Array.from(ours, (value) => value > 0),
    error,
  };
};

export type PitchRun = {
  start: number;
  end: number;
};

export const runsOf = (mask: readonly boolean[]): PitchRun[] => {
  const runs: PitchRun[] = [];
  let start = -1;
  mask.forEach((value, index) => {
    if (value && start < 0) {
      start = index;
    }
    if (!value && start >= 0) {
      runs.push({ start, end: index });
      start = -1;
    }
  });
  if (start >= 0) {
    runs.push({ start, end: mask.length });
  }
  return runs;
};

export const framesOf = (line: PitchLine, ms: number): number =>
  Math.max(1, Math.round(ms / 1000 / line.hopSeconds));

export const millisecondsOf = (line: PitchLine, run: PitchRun): number =>
  (run.end - run.start) * line.hopSeconds * 1000;

export const quantile = (values: number[], position: number): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.round(position * (sorted.length - 1))];
};

const stepAt = (line: PitchLine, index: number, lag: number): number => {
  const { reference, ours } = line;
  const before = index - lag;
  if (
    !line.voiced[index] ||
    !line.voiced[before] ||
    reference[index].f0 <= 0 ||
    reference[before].f0 <= 0
  ) {
    return 0;
  }
  const moved = Math.abs(centsBetween(ours[index], ours[before]));
  const voiceMoved = Math.abs(
    centsBetween(reference[index].f0, reference[before].f0),
  );
  const { stepCents, stillCents } = pitchLineThresholds;
  return moved > stepCents && voiceMoved < stillCents ? moved : 0;
};

export type PitchJerk = {
  start: number;
  end: number;
  cents: number;
};

export const findJerks = (line: PitchLine): PitchJerk[] => {
  const lag = framesOf(line, pitchLineThresholds.stepLagMs);
  const steps = line.reference.map((_, index) =>
    index >= lag ? stepAt(line, index, lag) : 0,
  );
  return runsOf(steps.map((cents) => cents > 0)).map((run) => ({
    start: run.start - lag,
    end: run.end,
    cents: Math.max(...steps.slice(run.start, run.end)),
  }));
};

export const markJerky = (line: PitchLine, jerks: PitchJerk[]): boolean[] => {
  const halo = framesOf(line, pitchLineThresholds.jerkyHaloMs);
  const jerky = line.reference.map(() => false);
  for (const jerk of jerks) {
    jerky.fill(
      true,
      Math.max(0, jerk.start - halo),
      Math.min(jerky.length, jerk.end + halo),
    );
  }
  return jerky;
};

type WindowMean = {
  mean: Float64Array;
  count: Float64Array;
};

const windowMean = (
  values: Float64Array,
  usable: readonly boolean[],
  half: number,
): WindowMean => {
  const { length } = values;
  const sum = new Float64Array(length + 1);
  const total = new Float64Array(length + 1);
  for (let index = 0; index < length; index += 1) {
    sum[index + 1] = sum[index] + (usable[index] ? values[index] : 0);
    total[index + 1] = total[index] + (usable[index] ? 1 : 0);
  }
  const mean = new Float64Array(length).fill(NaN);
  const count = new Float64Array(length);
  for (let index = 0; index < length; index += 1) {
    const from = Math.max(0, index - half);
    const to = Math.min(length, index + half + 1);
    count[index] = total[to] - total[from];
    if (count[index] > 0) {
      mean[index] = (sum[to] - sum[from]) / count[index];
    }
  }
  return { mean, count };
};

export type PitchRattle = {
  fastSquared: Float64Array;
  usable: boolean[];
  local: Float64Array;
};

export const measureRattle = (line: PitchLine): PitchRattle => {
  const {
    rattleOutlierCents,
    rattleSmoothMs,
    rattleWindowMs,
    rattleMinFrames,
  } = pitchLineThresholds;
  const usable = Array.from(
    line.error,
    (error) => Number.isFinite(error) && Math.abs(error) <= rattleOutlierCents,
  );
  const smooth = windowMean(
    line.error,
    usable,
    framesOf(line, rattleSmoothMs / 2),
  ).mean;
  const fastSquared = line.error.map((error, index) =>
    usable[index] ? (error - smooth[index]) ** 2 : 0,
  );
  const window = windowMean(
    fastSquared,
    usable,
    framesOf(line, rattleWindowMs / 2),
  );
  const local = window.mean.map((mean, index) =>
    usable[index] && window.count[index] >= rattleMinFrames
      ? Math.sqrt(mean)
      : NaN,
  );
  return { fastSquared, usable, local };
};

export type PitchPhantoms = {
  islands: number;
  tails: number;
};

export const countPhantoms = (line: PitchLine): PitchPhantoms => {
  const { reference } = line;
  const voiceAt = (index: number): boolean =>
    index >= 0 && index < reference.length && reference[index].f0 > 0;
  const phantoms = runsOf(
    line.voiced.map((voiced, index) => voiced && !voiceAt(index)),
  ).filter((run) => millisecondsOf(line, run) >= pitchLineThresholds.phantomMs);
  const tails = phantoms.filter(
    (run) => voiceAt(run.start - 1) || voiceAt(run.end),
  ).length;
  return { islands: phantoms.length - tails, tails };
};

const firstRightFrame = (line: PitchLine, run: PitchRun): number => {
  const search = framesOf(line, pitchLineThresholds.onsetSearchMs);
  const to = Math.min(line.singing.length, run.start + search);
  for (let index = run.start; index < to; index += 1) {
    if (Math.abs(line.error[index]) <= pitchLineThresholds.wrongCents) {
      return index;
    }
  }
  return -1;
};

export type PitchOnsets = {
  delaysMs: number[];
  missed: number;
};

export const measureOnsets = (line: PitchLine): PitchOnsets => {
  const gap = framesOf(line, pitchLineThresholds.onsetGapMs);
  const onsets: PitchOnsets = { delaysMs: [], missed: 0 };
  let previousEnd = -gap;
  for (const run of runsOf(line.singing)) {
    if (run.start - previousEnd >= gap) {
      const right = firstRightFrame(line, run);
      if (right < 0) {
        onsets.missed += 1;
      } else {
        onsets.delaysMs.push((right - run.start) * line.hopSeconds * 1000);
      }
    }
    previousEnd = run.end;
  }
  return onsets;
};
