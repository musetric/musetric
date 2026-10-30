import { type VocalFrames } from './frames.js';
import { type VocalDifference, type VocalMarkOf } from './marks.js';
import { findOverlapping, largestDifference, spanSeconds } from './match.js';
import { framesOf, median } from './math.js';
import { type VocalPhrase, voicedCents } from './segments.js';
import { type VocalVoice } from './voice.js';

const fallSeconds = 0.08;
const heldNoteSeconds = 0.2;
const fallMinCents = 40;
const matchShare = 0.5;
const markBeforeSeconds = 0.3;
const markAfterSeconds = 0.1;

const fallCents = 100;
const flatCents = 40;
const holdStepMs = 150;
const holdRatio = 1.25;

const lastHeldNote = (frames: VocalFrames, phrase: VocalPhrase) =>
  phrase.notes.findLast(
    (note) => (note.end - note.start) * frames.hopSeconds >= heldNoteSeconds,
  ) ?? phrase.notes.at(-1);

const measureFall = (frames: VocalFrames, phrase: VocalPhrase) => {
  const note = lastHeldNote(frames, phrase);
  if (!note) {
    return 0;
  }
  const cents = voicedCents(frames, {
    start: Math.max(
      note.start,
      phrase.end - framesOf(frames.hopSeconds, fallSeconds),
    ),
    end: phrase.end,
  });
  const offset = median(cents) - note.cents;
  return Math.abs(offset) >= fallMinCents ? offset : 0;
};

const measureHold = (frames: VocalFrames, phrase: VocalPhrase) => {
  const note = lastHeldNote(frames, phrase);
  return note ? (phrase.end - note.start) * frames.hopSeconds * 1000 : 0;
};

export type ReleaseTraits = {
  fallCents: number;
  holdMs: number;
};

const measureRelease = (
  frames: VocalFrames,
  phrase: VocalPhrase,
): ReleaseTraits => ({
  fallCents: measureFall(frames, phrase),
  holdMs: measureHold(frames, phrase),
});

export type ReleaseAdvice = 'fall' | 'noFall' | 'longer' | 'shorter';

const traitAdvice = (lead: ReleaseTraits): ReleaseAdvice | undefined =>
  lead.fallCents <= -fallCents ? 'fall' : undefined;

const fallDifference = (
  lead: ReleaseTraits,
  take: ReleaseTraits,
): VocalDifference<ReleaseAdvice> | undefined => {
  if (lead.fallCents <= -fallCents && take.fallCents > -flatCents) {
    return { advice: 'fall', size: -lead.fallCents / fallCents };
  }
  if (take.fallCents <= -fallCents && lead.fallCents > -flatCents) {
    return { advice: 'noFall', size: -take.fallCents / fallCents };
  }
  return undefined;
};

const holdDifference = (
  lead: ReleaseTraits,
  take: ReleaseTraits,
): VocalDifference<ReleaseAdvice> | undefined => {
  const gap = lead.holdMs - take.holdMs;
  const ratio =
    Math.max(lead.holdMs, take.holdMs) / Math.min(lead.holdMs, take.holdMs);
  if (Math.abs(gap) < holdStepMs || ratio < holdRatio) {
    return undefined;
  }
  return {
    advice: gap > 0 ? 'longer' : 'shorter',
    size: Math.abs(gap) / holdStepMs,
  };
};

export const compareReleases = (lead: ReleaseTraits, take: ReleaseTraits) =>
  largestDifference([fallDifference(lead, take), holdDifference(lead, take)]);

export type ReleaseMark = VocalMarkOf<'release', ReleaseTraits, ReleaseAdvice>;

export const detectReleases = (
  lead: VocalVoice,
  take: VocalVoice | undefined,
): ReleaseMark[] => {
  const marks: ReleaseMark[] = [];
  for (const phrase of lead.phrases) {
    const traits = measureRelease(lead.frames, phrase);
    const time = lead.songSeconds(phrase.end);
    const span = {
      start: time - markBeforeSeconds,
      end: time + markAfterSeconds,
    };
    const counterpart = take
      ? findOverlapping(
          take.phrases,
          spanSeconds(lead, phrase),
          (item) => spanSeconds(take, item),
          matchShare,
        )
      : undefined;
    if (!take || !counterpart) {
      const advice = traitAdvice(traits);
      if (advice) {
        marks.push({
          kind: 'release',
          ...span,
          status: 'trait',
          advice,
          lead: traits,
        });
      }
      continue;
    }
    const takeTraits = measureRelease(take.frames, counterpart);
    const difference = compareReleases(traits, takeTraits);
    marks.push({
      kind: 'release',
      ...span,
      status: difference ? 'differ' : 'match',
      advice: difference?.advice ?? traitAdvice(traits),
      lead: traits,
      take: takeTraits,
    });
  }
  return marks;
};
