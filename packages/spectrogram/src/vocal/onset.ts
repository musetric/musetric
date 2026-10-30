import { type VocalFrames } from './frames.js';
import { type VocalDifference, type VocalMarkOf } from './marks.js';
import { findNearest, largestDifference } from './match.js';
import { median, percentile } from './math.js';
import { type VocalPhrase, voicedCents } from './segments.js';
import { type VocalVoice } from './voice.js';

const floorFromSeconds = 0.4;
const floorToSeconds = 0.15;
const floorShare = 0.2;
const attackSeconds = 0.15;
const riseSearchSeconds = 0.1;
const riseRangeDb = 20;
const riseTopDb = 3;
const leadInMaxSeconds = 0.3;
const leadInFloorMarginDb = 10;
const leadInBelowAttackDb = 35;
const scoopSeconds = 0.06;
const scoopNoteSeconds = 0.2;
const scoopMinCents = 40;
const matchSeconds = 0.2;
const markBeforeSeconds = 0.05;
const markAfterSeconds = 0.15;

const hardRiseMs = 15;
const softRiseMs = 45;
const riseStepMs = 25;
const traitLeadInMs = 60;
const leadInStepMs = 40;
const scoopCents = 60;
const flatCents = 30;
const silenceDb = -120;

export type OnsetTraits = {
  riseMs: number;
  leadInMs: number;
  scoopCents: number;
};

type Hardness = 'hard' | 'medium' | 'soft';

const hardnessOf = (traits: OnsetTraits): Hardness => {
  if (traits.riseMs <= hardRiseMs) {
    return 'hard';
  }
  return traits.riseMs >= softRiseMs ? 'soft' : 'medium';
};

const framesOf = (frames: VocalFrames, seconds: number): number =>
  Math.round(seconds / frames.hopSeconds);

const measureRise = (frames: VocalFrames, start: number): number => {
  const from = Math.max(0, start - framesOf(frames, riseSearchSeconds));
  const to = Math.min(
    frames.body.length,
    start + framesOf(frames, attackSeconds),
  );
  let peak = Number.NEGATIVE_INFINITY;
  for (let index = start; index < to; index += 1) {
    peak = Math.max(peak, frames.body[index]);
  }
  let low = -1;
  for (let index = from; index < to; index += 1) {
    if (low < 0 && frames.body[index] >= peak - riseRangeDb) {
      low = index;
    }
    if (low >= 0 && frames.body[index] >= peak - riseTopDb) {
      return (index - low) * frames.hopSeconds * 1000;
    }
  }
  return 0;
};

const measureLeadIn = (frames: VocalFrames, start: number): number => {
  const before = Array.from(
    frames.air.subarray(
      Math.max(0, start - framesOf(frames, floorFromSeconds)),
      Math.max(0, start - framesOf(frames, floorToSeconds)),
    ),
  );
  const floor = before.length > 0 ? percentile(before, floorShare) : silenceDb;
  const attackEnd = Math.min(
    frames.level.length,
    start + framesOf(frames, attackSeconds),
  );
  let peak = Number.NEGATIVE_INFINITY;
  for (let index = start; index < attackEnd; index += 1) {
    peak = Math.max(peak, frames.level[index]);
  }
  const threshold = Math.max(
    floor + leadInFloorMarginDb,
    peak - leadInBelowAttackDb,
  );
  const limit = Math.max(0, start - framesOf(frames, leadInMaxSeconds));
  let count = 0;
  for (let index = start - 1; index >= limit; index -= 1) {
    if (frames.air[index] < threshold) {
      break;
    }
    count += 1;
  }
  return count * frames.hopSeconds * 1000;
};

const measureScoop = (frames: VocalFrames, phrase: VocalPhrase): number => {
  const note = phrase.notes.find(
    (item) => item.start - phrase.start <= framesOf(frames, scoopNoteSeconds),
  );
  if (!note) {
    return 0;
  }
  const cents = voicedCents(frames, {
    start: phrase.start,
    end: Math.min(phrase.end, phrase.start + framesOf(frames, scoopSeconds)),
  });
  const offset = median(cents) - note.cents;
  return Math.abs(offset) >= scoopMinCents ? offset : 0;
};

const measureOnset = (
  frames: VocalFrames,
  phrase: VocalPhrase,
): OnsetTraits => ({
  riseMs: measureRise(frames, phrase.start),
  leadInMs: measureLeadIn(frames, phrase.start),
  scoopCents: measureScoop(frames, phrase),
});

export type OnsetAdvice =
  'softer' | 'harder' | 'moreLeadIn' | 'lessLeadIn' | 'scoop' | 'noScoop';

const traitAdvice = (lead: OnsetTraits): OnsetAdvice | undefined => {
  if (lead.scoopCents <= -scoopCents) {
    return 'scoop';
  }
  if (lead.leadInMs >= traitLeadInMs) {
    return 'moreLeadIn';
  }
  const hardness = hardnessOf(lead);
  if (hardness === 'soft') {
    return 'softer';
  }
  return hardness === 'hard' ? 'harder' : undefined;
};

const riseDifference = (
  lead: OnsetTraits,
  take: OnsetTraits,
): VocalDifference<OnsetAdvice> | undefined => {
  const leadHardness = hardnessOf(lead);
  const takeHardness = hardnessOf(take);
  const gap = lead.riseMs - take.riseMs;
  if (leadHardness === 'soft' && takeHardness !== 'soft' && gap >= riseStepMs) {
    return { advice: 'softer', size: gap / riseStepMs };
  }
  if (
    leadHardness === 'hard' &&
    takeHardness !== 'hard' &&
    -gap >= riseStepMs
  ) {
    return { advice: 'harder', size: -gap / riseStepMs };
  }
  return undefined;
};

const leadInDifference = (
  lead: OnsetTraits,
  take: OnsetTraits,
): VocalDifference<OnsetAdvice> | undefined => {
  const gap = lead.leadInMs - take.leadInMs;
  if (Math.abs(gap) < leadInStepMs) {
    return undefined;
  }
  return {
    advice: gap > 0 ? 'moreLeadIn' : 'lessLeadIn',
    size: Math.abs(gap) / leadInStepMs,
  };
};

const scoopDifference = (
  lead: OnsetTraits,
  take: OnsetTraits,
): VocalDifference<OnsetAdvice> | undefined => {
  if (lead.scoopCents <= -scoopCents && take.scoopCents > -flatCents) {
    return { advice: 'scoop', size: -lead.scoopCents / scoopCents };
  }
  if (take.scoopCents <= -scoopCents && lead.scoopCents > -flatCents) {
    return { advice: 'noScoop', size: -take.scoopCents / scoopCents };
  }
  return undefined;
};

export const compareOnsets = (lead: OnsetTraits, take: OnsetTraits) =>
  largestDifference([
    riseDifference(lead, take),
    leadInDifference(lead, take),
    scoopDifference(lead, take),
  ]);

export type OnsetMark = VocalMarkOf<'onset', OnsetTraits, OnsetAdvice>;

export const detectOnsets = (
  lead: VocalVoice,
  take: VocalVoice | undefined,
): OnsetMark[] => {
  const marks: OnsetMark[] = [];
  for (const phrase of lead.phrases) {
    const traits = measureOnset(lead.frames, phrase);
    const time = lead.songSeconds(phrase.start);
    const span = {
      start: time - traits.leadInMs / 1000 - markBeforeSeconds,
      end: time + markAfterSeconds,
    };
    const counterpart = take
      ? findNearest(
          take.phrases,
          time,
          (item) => take.songSeconds(item.start),
          matchSeconds,
        )
      : undefined;
    if (!take || !counterpart) {
      const advice = traitAdvice(traits);
      if (advice) {
        marks.push({
          kind: 'onset',
          ...span,
          status: 'trait',
          advice,
          lead: traits,
        });
      }
      continue;
    }
    const takeTraits = measureOnset(take.frames, counterpart);
    const difference = compareOnsets(traits, takeTraits);
    marks.push({
      kind: 'onset',
      ...span,
      status: difference ? 'differ' : 'match',
      advice: difference?.advice ?? traitAdvice(traits),
      lead: traits,
      take: takeTraits,
    });
  }
  return marks;
};
