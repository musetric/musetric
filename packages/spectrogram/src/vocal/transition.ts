import { type VocalFrames } from './frames.js';
import { type VocalDifference, type VocalMarkOf } from './marks.js';
import { findNearest, largestDifference } from './match.js';
import { centsOf, framesOf } from './math.js';
import { type VocalNote, type VocalPhrase } from './segments.js';
import { type VocalVoice } from './voice.js';

const minIntervalCents = 80;
const landingCents = 35;
const overshootSeconds = 0.15;
const settleSeconds = 0.1;
const minOvershootCents = 15;
const maxUnvoicedShare = 0.3;
const matchSeconds = 0.2;
const sameIntervalCents = 100;
const markBeforeSeconds = 0.05;
const markAfterSeconds = 0.1;

const stepMs = 40;
const slideMs = 90;
const traitSlideMs = 120;
const overshootCents = 40;
const traitOvershootCents = 50;
const flatOvershootCents = 15;

const centsAt = (frames: VocalFrames, index: number) => {
  const pitch = frames.pitch[index];
  return pitch > 0 ? centsOf(pitch) : Number.NaN;
};

const measureOvershoot = (
  frames: VocalFrames,
  arrive: number,
  target: number,
  direction: number,
) => {
  const end = Math.min(
    frames.pitch.length,
    arrive + framesOf(frames.hopSeconds, overshootSeconds),
  );
  let beyond = 0;
  let peak = arrive;
  for (let index = arrive; index < end; index += 1) {
    const offset = (centsAt(frames, index) - target) * direction;
    if (offset > beyond) {
      beyond = offset;
      peak = index;
    }
  }
  const settleEnd = Math.min(
    frames.pitch.length,
    end + framesOf(frames.hopSeconds, settleSeconds),
  );
  let settled = false;
  for (let index = peak; index < settleEnd && !settled; index += 1) {
    settled = Math.abs(centsAt(frames, index) - target) <= landingCents;
  }
  if (!settled) {
    return 0;
  }
  return beyond >= minOvershootCents ? beyond : 0;
};

export type TransitionTraits = {
  intervalCents: number;
  slideMs: number;
  overshootCents: number;
};

type Transition = {
  leave: number;
  arrive: number;
  traits: TransitionTraits;
};

const measureTransition = (
  frames: VocalFrames,
  from: VocalNote,
  to: VocalNote,
): Transition | undefined => {
  const interval = to.cents - from.cents;
  if (Math.abs(interval) < minIntervalCents) {
    return undefined;
  }
  const searchStart = Math.floor((from.start + from.end) / 2);
  const searchEnd = Math.floor((to.start + to.end) / 2);
  let arrive = -1;
  for (let index = searchStart; index < searchEnd && arrive < 0; index += 1) {
    if (Math.abs(centsAt(frames, index) - to.cents) <= landingCents) {
      arrive = index;
    }
  }
  if (arrive < 0) {
    return undefined;
  }
  let leave = searchStart;
  for (let index = arrive; index >= searchStart; index -= 1) {
    if (Math.abs(centsAt(frames, index) - from.cents) <= landingCents) {
      leave = index;
      break;
    }
  }
  let unvoiced = 0;
  for (let index = leave; index < arrive; index += 1) {
    unvoiced += frames.pitch[index] > 0 ? 0 : 1;
  }
  if (unvoiced > maxUnvoicedShare * Math.max(1, arrive - leave)) {
    return undefined;
  }
  return {
    leave,
    arrive,
    traits: {
      intervalCents: interval,
      slideMs: (arrive - leave) * frames.hopSeconds * 1000,
      overshootCents: measureOvershoot(
        frames,
        arrive,
        to.cents,
        Math.sign(interval),
      ),
    },
  };
};

const middleSeconds = (voice: VocalVoice, transition: Transition) =>
  (voice.songSeconds(transition.leave) + voice.songSeconds(transition.arrive)) /
  2;

const findTransitions = (voice: VocalVoice): Transition[] =>
  voice.phrases.flatMap((phrase: VocalPhrase) =>
    phrase.notes.slice(1).flatMap((note, index) => {
      const transition = measureTransition(
        voice.frames,
        phrase.notes[index],
        note,
      );
      return transition ? [transition] : [];
    }),
  );

export type TransitionAdvice = 'slide' | 'step' | 'overshoot' | 'noOvershoot';

const traitAdvice = (lead: TransitionTraits): TransitionAdvice | undefined => {
  if (lead.overshootCents >= traitOvershootCents) {
    return 'overshoot';
  }
  return lead.slideMs >= traitSlideMs ? 'slide' : undefined;
};

const slideDifference = (
  lead: TransitionTraits,
  take: TransitionTraits,
): VocalDifference<TransitionAdvice> | undefined => {
  if (lead.slideMs >= slideMs && take.slideMs <= lead.slideMs / 2) {
    return { advice: 'slide', size: (lead.slideMs - take.slideMs) / slideMs };
  }
  if (lead.slideMs <= stepMs && take.slideMs >= slideMs) {
    return { advice: 'step', size: (take.slideMs - lead.slideMs) / slideMs };
  }
  return undefined;
};

const overshootDifference = (
  lead: TransitionTraits,
  take: TransitionTraits,
): VocalDifference<TransitionAdvice> | undefined => {
  if (
    lead.overshootCents >= overshootCents &&
    take.overshootCents <= flatOvershootCents
  ) {
    return { advice: 'overshoot', size: lead.overshootCents / overshootCents };
  }
  if (
    take.overshootCents >= overshootCents &&
    lead.overshootCents <= flatOvershootCents
  ) {
    return {
      advice: 'noOvershoot',
      size: take.overshootCents / overshootCents,
    };
  }
  return undefined;
};

export const compareTransitions = (
  lead: TransitionTraits,
  take: TransitionTraits,
) =>
  largestDifference([
    slideDifference(lead, take),
    overshootDifference(lead, take),
  ]);

export type TransitionMark = VocalMarkOf<
  'transition',
  TransitionTraits,
  TransitionAdvice
>;

export const detectTransitions = (
  lead: VocalVoice,
  take: VocalVoice | undefined,
): TransitionMark[] => {
  const takeTransitions = take ? findTransitions(take) : [];
  const marks: TransitionMark[] = [];
  for (const transition of findTransitions(lead)) {
    const { traits } = transition;
    const time = lead.songSeconds(transition.arrive);
    const span = {
      start: lead.songSeconds(transition.leave) - markBeforeSeconds,
      end: time + markAfterSeconds,
    };
    const counterpart = take
      ? findNearest(
          takeTransitions.filter(
            (item) =>
              Math.abs(item.traits.intervalCents - traits.intervalCents) <=
              sameIntervalCents,
          ),
          middleSeconds(lead, transition),
          (item) => middleSeconds(take, item),
          matchSeconds,
        )
      : undefined;
    if (!counterpart) {
      const advice = traitAdvice(traits);
      if (advice) {
        marks.push({
          kind: 'transition',
          ...span,
          status: 'trait',
          advice,
          lead: traits,
        });
      }
      continue;
    }
    const difference = compareTransitions(traits, counterpart.traits);
    if (!difference && !traitAdvice(traits)) {
      continue;
    }
    marks.push({
      kind: 'transition',
      ...span,
      status: difference ? 'differ' : 'match',
      advice: difference?.advice ?? traitAdvice(traits),
      lead: traits,
      take: counterpart.traits,
    });
  }
  return marks;
};
