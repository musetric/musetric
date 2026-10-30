import { type VocalFrames } from './frames.js';
import { type VocalMarkOf } from './marks.js';
import { findNearest, spanSeconds } from './match.js';
import { framesOf, median } from './math.js';
import { type VocalPhrase } from './segments.js';
import { type VocalVoice } from './voice.js';

const riseSeconds = 0.04;
const riseDb = 8;
const slopeFrames = 2;
const minGapSeconds = 0.1;
const leadInSeconds = 0.05;
const matchSeconds = 0.15;
const minOnsets = 3;
const sameSignShare = 0.7;
const offsetMs = 40;

const steepestFrame = (frames: VocalFrames, from: number, to: number) => {
  let best = from;
  let bestSlope = Number.NEGATIVE_INFINITY;
  for (let index = Math.max(from, slopeFrames); index <= to; index += 1) {
    const slope = frames.body[index] - frames.body[index - slopeFrames];
    if (slope > bestSlope) {
      best = index;
      bestSlope = slope;
    }
  }
  return best;
};

export const findVowelOnsets = (
  frames: VocalFrames,
  phrase: VocalPhrase,
): number[] => {
  const window = framesOf(frames.hopSeconds, riseSeconds);
  const gap = framesOf(frames.hopSeconds, minGapSeconds);
  const onsets: number[] = [];
  const from = Math.max(
    window,
    phrase.start - framesOf(frames.hopSeconds, leadInSeconds),
  );
  for (let index = from; index < phrase.end; index += 1) {
    if (frames.pitch[index] <= 0) {
      continue;
    }
    let low = frames.body[index];
    for (let back = index - window; back < index; back += 1) {
      low = Math.min(low, frames.body[back]);
    }
    const last = onsets.at(-1) ?? Number.NEGATIVE_INFINITY;
    if (frames.body[index] - low >= riseDb && index - last >= gap) {
      onsets.push(steepestFrame(frames, index - window, index));
      index += gap;
    }
  }
  return onsets;
};

export type VowelOnsetPair = {
  phrase: VocalPhrase;
  lead: number;
  take: number;
};

export const pairVowelOnsets = (
  lead: VocalVoice,
  take: VocalVoice,
): VowelOnsetPair[] => {
  const takeOnsets = take.phrases.flatMap((phrase) =>
    findVowelOnsets(take.frames, phrase).map((frame) => ({
      time: take.songSeconds(frame),
    })),
  );
  return lead.phrases.flatMap((phrase) =>
    findVowelOnsets(lead.frames, phrase).flatMap((frame) => {
      const time = lead.songSeconds(frame);
      const other = findNearest(
        takeOnsets,
        time,
        (item) => item.time,
        matchSeconds,
      );
      return other === undefined
        ? []
        : [{ phrase, lead: time, take: other.time }];
    }),
  );
};

export type TimingTraits = {
  offsetMs: number;
  overallMs: number;
  onsets: number;
};

export const measureTiming = (
  differences: readonly number[],
  overallMs: number,
): TimingTraits => ({
  offsetMs: median(differences.map((difference) => difference - overallMs)),
  overallMs,
  onsets: differences.length,
});

export type TimingAdvice = 'earlier' | 'later';

export const compareTiming = (
  differences: readonly number[],
  traits: TimingTraits,
): TimingAdvice | undefined => {
  if (traits.onsets < minOnsets || Math.abs(traits.offsetMs) < offsetMs) {
    return undefined;
  }
  const sign = Math.sign(traits.offsetMs);
  const agreeing = differences.filter(
    (difference) => Math.sign(difference - traits.overallMs) === sign,
  ).length;
  if (agreeing < sameSignShare * differences.length) {
    return undefined;
  }
  return sign > 0 ? 'earlier' : 'later';
};

export type TimingMark = VocalMarkOf<'timing', TimingTraits, TimingAdvice>;

export const detectTimings = (
  lead: VocalVoice,
  take: VocalVoice | undefined,
): TimingMark[] => {
  if (!take) {
    return [];
  }
  const pairs = pairVowelOnsets(lead, take).map((pair) => ({
    phrase: pair.phrase,
    differenceMs: (pair.take - pair.lead) * 1000,
  }));
  const overallMs = median(pairs.map((pair) => pair.differenceMs));
  const marks: TimingMark[] = [];
  for (const phrase of lead.phrases) {
    const differences = pairs
      .filter((pair) => pair.phrase === phrase)
      .map((pair) => pair.differenceMs);
    if (differences.length < minOnsets) {
      continue;
    }
    const traits = measureTiming(differences, overallMs);
    const advice = compareTiming(differences, traits);
    marks.push({
      kind: 'timing',
      ...spanSeconds(lead, phrase),
      status: advice ? 'differ' : 'match',
      advice,
      lead: { offsetMs: 0, overallMs: 0, onsets: traits.onsets },
      take: traits,
    });
  }
  return marks;
};
