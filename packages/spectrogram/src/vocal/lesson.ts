import { centsOf, framesOf, median } from './math.js';
import { type VocalNote, type VocalPhrase } from './segments.js';
import { pairVowelOnsets, type VowelOnsetPair } from './timing.js';
import { type VocalVoice } from './voice.js';

const sungShare = 0.5;
const matchSeconds = 0.02;
const minNoteSeconds = 0.15;
const fullNoteSeconds = 0.4;
const edgeShare = 0.2;
const maxEdgeSeconds = 0.08;
const pitchToleranceCents = 50;
const octaveCents = 1200;
const minOnsets = 3;
const timingToleranceMs = 40;
const sameSignShare = 0.7;
const timingWeight = 0.8;
const focusBeforeSeconds = 0.05;
const focusAfterSeconds = 0.25;
const defaultPlaceCount = 3;

type TakeLine = {
  times: Float64Array;
  cents: Float64Array;
};

const takeLineOf = (take: VocalVoice): TakeLine => {
  const times: number[] = [];
  const cents: number[] = [];
  take.frames.pitch.forEach((value, frame) => {
    if (value > 0) {
      times.push(take.songSeconds(frame));
      cents.push(centsOf(value));
    }
  });
  return { times: Float64Array.from(times), cents: Float64Array.from(cents) };
};

const centsAt = (line: TakeLine, time: number): number | undefined => {
  let low = 0;
  let high = line.times.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (line.times[middle] < time) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  let best: number | undefined = undefined;
  let bestDistance = matchSeconds;
  for (const index of [low - 1, low]) {
    if (index < 0 || index >= line.times.length) {
      continue;
    }
    const distance = Math.abs(line.times[index] - time);
    if (distance <= bestDistance) {
      best = line.cents[index];
      bestDistance = distance;
    }
  }
  return best;
};

const octaveFolded = (cents: number) =>
  cents - octaveCents * Math.round(cents / octaveCents);

const isSung = (lead: VocalVoice, line: TakeLine, phrase: VocalPhrase) => {
  let voiced = 0;
  let matched = 0;
  for (let frame = phrase.start; frame < phrase.end; frame += 1) {
    if (lead.frames.pitch[frame] <= 0) {
      continue;
    }
    voiced += 1;
    if (centsAt(line, lead.songSeconds(frame)) !== undefined) {
      matched += 1;
    }
  }
  return voiced > 0 && matched >= sungShare * voiced;
};

export type VocalLessonConcept = 'pitch' | 'timing';

export type VocalLessonDirection = 'lower' | 'higher' | 'early' | 'late';

export type VocalLessonDifference = {
  concept: VocalLessonConcept;
  direction: VocalLessonDirection;
  size: number;
  focusStart: number;
  focusEnd: number;
  severity: number;
};

const comparePitch = (
  lead: VocalVoice,
  line: TakeLine,
  note: VocalNote,
): VocalLessonDifference | undefined => {
  const { hopSeconds } = lead.frames;
  const seconds = (note.end - note.start) * hopSeconds;
  if (seconds < minNoteSeconds) {
    return undefined;
  }
  const edge = Math.min(
    Math.round((note.end - note.start) * edgeShare),
    framesOf(hopSeconds, maxEdgeSeconds),
  );
  const offsets: number[] = [];
  let voiced = 0;
  for (let frame = note.start + edge; frame < note.end - edge; frame += 1) {
    if (lead.frames.pitch[frame] <= 0) {
      continue;
    }
    voiced += 1;
    const cents = centsAt(line, lead.songSeconds(frame));
    if (cents !== undefined) {
      offsets.push(octaveFolded(cents - note.cents));
    }
  }
  if (voiced === 0 || offsets.length < sungShare * voiced) {
    return undefined;
  }
  const error = median(offsets);
  if (Math.abs(error) < pitchToleranceCents) {
    return undefined;
  }
  return {
    concept: 'pitch',
    direction: error < 0 ? 'lower' : 'higher',
    size: Math.abs(error),
    focusStart: lead.songSeconds(note.start),
    focusEnd: lead.songSeconds(note.end),
    severity:
      (Math.abs(error) / pitchToleranceCents) *
      Math.min(1, seconds / fullNoteSeconds),
  };
};

const compareTiming = (
  pairs: readonly VowelOnsetPair[],
  overallMs: number,
): VocalLessonDifference | undefined => {
  if (pairs.length < minOnsets) {
    return undefined;
  }
  const offsets = pairs.map(
    (pair) => (pair.take - pair.lead) * 1000 - overallMs,
  );
  const offset = median(offsets);
  if (Math.abs(offset) < timingToleranceMs) {
    return undefined;
  }
  const sign = Math.sign(offset);
  const agreeing = offsets.filter((item) => Math.sign(item) === sign).length;
  if (agreeing < sameSignShare * offsets.length) {
    return undefined;
  }
  let [focus] = pairs;
  let focusOffset = 0;
  pairs.forEach((pair, index) => {
    const value = offsets[index] * sign;
    if (value > focusOffset) {
      focus = pair;
      focusOffset = value;
    }
  });
  return {
    concept: 'timing',
    direction: sign > 0 ? 'late' : 'early',
    size: Math.abs(offset),
    focusStart: Math.min(focus.lead, focus.take) - focusBeforeSeconds,
    focusEnd: Math.max(focus.lead, focus.take) + focusAfterSeconds,
    severity: (Math.abs(offset) / timingToleranceMs) * timingWeight,
  };
};

const mostSevere = (
  differences: readonly (VocalLessonDifference | undefined)[],
): VocalLessonDifference | undefined => {
  let worst: VocalLessonDifference | undefined = undefined;
  for (const difference of differences) {
    if (difference && (!worst || difference.severity > worst.severity)) {
      worst = difference;
    }
  }
  return worst;
};

export type VocalLessonPhrase = {
  start: number;
  end: number;
  sung: boolean;
  difference?: VocalLessonDifference;
};

export const assessVocalLesson = (
  lead: VocalVoice,
  take: VocalVoice | undefined,
): VocalLessonPhrase[] => {
  const line = take ? takeLineOf(take) : undefined;
  const pairs = take ? pairVowelOnsets(lead, take) : [];
  const overallMs = median(pairs.map((pair) => (pair.take - pair.lead) * 1000));
  return lead.phrases.map((phrase) => {
    const span = {
      start: lead.songSeconds(phrase.start),
      end: lead.songSeconds(phrase.end),
    };
    if (!line || !isSung(lead, line, phrase)) {
      return { ...span, sung: false };
    }
    const difference = mostSevere([
      ...phrase.notes.map((note) => comparePitch(lead, line, note)),
      compareTiming(
        pairs.filter((pair) => pair.phrase === phrase),
        overallMs,
      ),
    ]);
    return { ...span, sung: true, difference };
  });
};

export const pickLessonPlaces = (
  phrases: readonly VocalLessonPhrase[],
  count = defaultPlaceCount,
): VocalLessonPhrase[] =>
  phrases
    .filter((phrase) => phrase.sung && phrase.difference)
    .toSorted(
      (left, right) =>
        (right.difference?.severity ?? 0) - (left.difference?.severity ?? 0),
    )
    .slice(0, count)
    .toSorted((left, right) => left.start - right.start);
