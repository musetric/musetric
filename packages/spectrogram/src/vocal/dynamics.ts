import { type VocalFrames } from './frames.js';
import { type VocalMarkOf } from './marks.js';
import { findNoteCounterpart, longNotes, spanSeconds } from './match.js';
import { type VocalNote } from './segments.js';
import { type VocalVoice } from './voice.js';

const minNoteSeconds = 0.5;
const traitNoteSeconds = 0.7;
const edgeShare = 0.15;
const swellSlope = 4;
const fadeSlope = -6;
const steadySlope = 8;
const minRangeDb = 3;

export type DynamicsTraits = {
  slopeDbPerSecond: number;
  rangeDb: number;
  durationMs: number;
};

type DynamicsShape = 'swell' | 'fade' | 'steady';

const shapeOf = (traits: DynamicsTraits): DynamicsShape => {
  if (traits.rangeDb < minRangeDb) {
    return 'steady';
  }
  if (traits.slopeDbPerSecond >= swellSlope) {
    return 'swell';
  }
  return traits.slopeDbPerSecond <= fadeSlope ? 'fade' : 'steady';
};

export const measureDynamics = (
  frames: VocalFrames,
  note: VocalNote,
): DynamicsTraits => {
  const length = note.end - note.start;
  const from = note.start + Math.floor(length * edgeShare);
  const to = note.end - Math.floor(length * edgeShare);
  let count = 0;
  let sumTime = 0;
  let sumLevel = 0;
  let sumTimeLevel = 0;
  let sumTimeSquare = 0;
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (let index = from; index < to; index += 1) {
    if (frames.pitch[index] <= 0) {
      continue;
    }
    const time = (index - from) * frames.hopSeconds;
    const level = frames.body[index];
    count += 1;
    sumTime += time;
    sumLevel += level;
    sumTimeLevel += time * level;
    sumTimeSquare += time * time;
    low = Math.min(low, level);
    high = Math.max(high, level);
  }
  const spread = count * sumTimeSquare - sumTime * sumTime;
  return {
    slopeDbPerSecond:
      spread > 0 ? (count * sumTimeLevel - sumTime * sumLevel) / spread : 0,
    rangeDb: count > 0 ? high - low : 0,
    durationMs: length * frames.hopSeconds * 1000,
  };
};

export type DynamicsAdvice = 'swell' | 'fade' | 'steady';

export const compareDynamics = (
  lead: DynamicsTraits,
  take: DynamicsTraits,
): DynamicsAdvice | undefined => {
  const leadShape = shapeOf(lead);
  const takeShape = shapeOf(take);
  if (leadShape === takeShape) {
    return undefined;
  }
  if (leadShape !== 'steady') {
    return leadShape;
  }
  return Math.abs(take.slopeDbPerSecond) >= steadySlope ? 'steady' : undefined;
};

const traitAdvice = (lead: DynamicsTraits): DynamicsAdvice | undefined => {
  const shape = shapeOf(lead);
  return shape !== 'steady' && lead.durationMs >= traitNoteSeconds * 1000
    ? shape
    : undefined;
};

export type DynamicsMark = VocalMarkOf<
  'dynamics',
  DynamicsTraits,
  DynamicsAdvice
>;

const takeMark = (
  span: Pick<DynamicsMark, 'start' | 'end'>,
  lead: DynamicsTraits,
  take: DynamicsTraits,
): DynamicsMark | undefined => {
  const advice = compareDynamics(lead, take);
  if (!advice && !traitAdvice(lead)) {
    return undefined;
  }
  return {
    kind: 'dynamics',
    ...span,
    status: advice ? 'differ' : 'match',
    advice: advice ?? traitAdvice(lead),
    lead,
    take,
  };
};

export const detectDynamics = (
  lead: VocalVoice,
  take: VocalVoice | undefined,
): DynamicsMark[] => {
  const takeNotes = take ? longNotes(take, minNoteSeconds) : [];
  const marks: DynamicsMark[] = [];
  for (const note of longNotes(lead, minNoteSeconds)) {
    const traits = measureDynamics(lead.frames, note);
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
    const mark =
      take && counterpart
        ? takeMark(span, traits, measureDynamics(take.frames, counterpart))
        : undefined;
    const advice = traitAdvice(traits);
    if (mark) {
      marks.push(mark);
    } else if (!counterpart && advice) {
      marks.push({
        kind: 'dynamics',
        ...span,
        status: 'trait',
        advice,
        lead: traits,
      });
    }
  }
  return marks;
};
