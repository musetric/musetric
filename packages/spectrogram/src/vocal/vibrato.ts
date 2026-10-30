import { type VocalFrames } from './frames.js';
import { type VocalDifference, type VocalMarkOf } from './marks.js';
import {
  findNoteCounterpart,
  largestDifference,
  longNotes,
  spanSeconds,
} from './match.js';
import { centsOf, median } from './math.js';
import { smoothedCents, type VocalNote } from './segments.js';
import { type VocalVoice } from './voice.js';

const minNoteSeconds = 0.45;
const hysteresisCents = 8;
const minHalfSeconds = 1 / (2 * 8.5);
const maxHalfSeconds = 1 / (2 * 3.5);
const minDepthCents = 30;
const minHalfCycles = 5;
const minCoverage = 0.3;

const delayStepMs = 150;
const rateStepHz = 1.2;
const rateWeight = 0.5;
const extentRatio = 1.6;

type Extremum = {
  index: number;
  value: number;
};

const findExtrema = (residual: Float32Array): Extremum[] => {
  const extrema: Extremum[] = [];
  let candidate: Extremum = { index: 0, value: residual[0] };
  let rising = true;
  let settled = false;
  residual.forEach((value, index) => {
    const beyond = rising ? value > candidate.value : value < candidate.value;
    if (beyond) {
      candidate = { index, value };
      return;
    }
    if (Math.abs(value - candidate.value) < hysteresisCents) {
      return;
    }
    if (settled) {
      extrema.push(candidate);
    }
    settled = true;
    rising = !rising;
    candidate = { index, value };
  });
  return extrema;
};

type HalfCycle = {
  start: number;
  seconds: number;
  depth: number;
};

const longestRun = (halves: readonly HalfCycle[]): HalfCycle[] => {
  let best: HalfCycle[] = [];
  let run: HalfCycle[] = [];
  for (const half of halves) {
    const valid =
      half.seconds >= minHalfSeconds &&
      half.seconds <= maxHalfSeconds &&
      half.depth >= minDepthCents;
    run = valid ? [...run, half] : [];
    if (run.length > best.length) {
      best = run;
    }
  }
  return best;
};

export type VibratoTraits = {
  vibrato: boolean;
  delayMs: number;
  rateHz: number;
  extentCents: number;
};

const straight: VibratoTraits = {
  vibrato: false,
  delayMs: 0,
  rateHz: 0,
  extentCents: 0,
};

export const measureVibrato = (
  frames: VocalFrames,
  note: VocalNote,
): VibratoTraits => {
  const trend = smoothedCents(frames, note);
  const residual = Float32Array.from(trend, (value, offset) => {
    const pitch = frames.pitch[note.start + offset];
    return pitch > 0 ? centsOf(pitch) - value : 0;
  });
  const extrema = findExtrema(residual);
  const halves = extrema.slice(1).map((extremum, index) => ({
    start: extrema[index].index,
    seconds: (extremum.index - extrema[index].index) * frames.hopSeconds,
    depth: Math.abs(extremum.value - extrema[index].value),
  }));
  const run = longestRun(halves);
  const covered = run.reduce((sum, half) => sum + half.seconds, 0);
  const noteSeconds = (note.end - note.start) * frames.hopSeconds;
  if (run.length < minHalfCycles || covered < minCoverage * noteSeconds) {
    return straight;
  }
  return {
    vibrato: true,
    delayMs: run[0].start * frames.hopSeconds * 1000,
    rateHz: 1 / (2 * median(run.map((half) => half.seconds))),
    extentCents: median(run.map((half) => half.depth)),
  };
};

export type VibratoAdvice =
  | 'add'
  | 'straight'
  | 'later'
  | 'earlier'
  | 'slower'
  | 'faster'
  | 'narrower'
  | 'wider';

const timingDifference = (
  lead: VibratoTraits,
  take: VibratoTraits,
): VocalDifference<VibratoAdvice> | undefined => {
  const gap = lead.delayMs - take.delayMs;
  if (Math.abs(gap) < delayStepMs) {
    return undefined;
  }
  return {
    advice: gap > 0 ? 'later' : 'earlier',
    size: Math.abs(gap) / delayStepMs,
  };
};

const rateDifference = (
  lead: VibratoTraits,
  take: VibratoTraits,
): VocalDifference<VibratoAdvice> | undefined => {
  const gap = take.rateHz - lead.rateHz;
  if (Math.abs(gap) < rateStepHz) {
    return undefined;
  }
  return {
    advice: gap > 0 ? 'slower' : 'faster',
    size: (rateWeight * Math.abs(gap)) / rateStepHz,
  };
};

const extentDifference = (
  lead: VibratoTraits,
  take: VibratoTraits,
): VocalDifference<VibratoAdvice> | undefined => {
  const ratio = take.extentCents / lead.extentCents;
  if (ratio >= extentRatio) {
    return { advice: 'narrower', size: ratio / extentRatio };
  }
  if (1 / ratio >= extentRatio) {
    return { advice: 'wider', size: 1 / ratio / extentRatio };
  }
  return undefined;
};

export const compareVibratos = (
  lead: VibratoTraits,
  take: VibratoTraits,
): VocalDifference<VibratoAdvice> | undefined => {
  if (lead.vibrato !== take.vibrato) {
    return { advice: lead.vibrato ? 'add' : 'straight', size: 2 };
  }
  if (!lead.vibrato) {
    return undefined;
  }
  return largestDifference([
    timingDifference(lead, take),
    rateDifference(lead, take),
    extentDifference(lead, take),
  ]);
};

export type VibratoMark = VocalMarkOf<'vibrato', VibratoTraits, VibratoAdvice>;

type VibratoSpan = Pick<VibratoMark, 'start' | 'end'>;

const vibratoMark = (
  span: VibratoSpan,
  lead: VibratoTraits,
  take: VibratoTraits,
): VibratoMark | undefined => {
  if (!lead.vibrato && !take.vibrato) {
    return undefined;
  }
  const difference = compareVibratos(lead, take);
  return {
    kind: 'vibrato',
    ...span,
    status: difference ? 'differ' : 'match',
    advice: difference?.advice ?? 'add',
    lead,
    take,
  };
};

export const detectVibratos = (
  lead: VocalVoice,
  take: VocalVoice | undefined,
): VibratoMark[] => {
  const takeNotes = take ? longNotes(take, minNoteSeconds) : [];
  const marks: VibratoMark[] = [];
  for (const note of longNotes(lead, minNoteSeconds)) {
    const traits = measureVibrato(lead.frames, note);
    const span = spanSeconds(lead, note);
    const counterpart = take
      ? findNoteCounterpart({
          lead,
          note,
          take,
          takeNotes,
          anyOctave: true,
        })
      : undefined;
    if (take && counterpart) {
      const mark = vibratoMark(
        span,
        traits,
        measureVibrato(take.frames, counterpart),
      );
      if (mark) {
        marks.push(mark);
      }
    } else if (traits.vibrato) {
      marks.push({
        kind: 'vibrato',
        ...span,
        status: 'trait',
        advice: 'add',
        lead: traits,
      });
    }
  }
  return marks;
};
