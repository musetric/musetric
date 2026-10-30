import { type VocalDifference } from './marks.js';
import { type VocalNote, type VocalSpan } from './segments.js';
import { type VocalVoice } from './voice.js';

export const largestDifference = <Advice extends string>(
  differences: readonly (VocalDifference<Advice> | undefined)[],
): VocalDifference<Advice> | undefined => {
  let largest: VocalDifference<Advice> | undefined = undefined;
  for (const difference of differences) {
    if (difference && (!largest || difference.size > largest.size)) {
      largest = difference;
    }
  }
  return largest;
};

export const findNearest = <Item>(
  items: readonly Item[],
  time: number,
  timeOf: (item: Item) => number,
  tolerance: number,
): Item | undefined => {
  let best: Item | undefined = undefined;
  let bestDistance = tolerance;
  for (const item of items) {
    const distance = Math.abs(timeOf(item) - time);
    if (distance <= bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
};

export type VocalSecondsSpan = {
  start: number;
  end: number;
};

export const spanSeconds = (
  voice: VocalVoice,
  span: VocalSpan,
): VocalSecondsSpan => ({
  start: voice.songSeconds(span.start),
  end: voice.songSeconds(span.end),
});

export const findOverlapping = <Item>(
  items: readonly Item[],
  span: VocalSecondsSpan,
  spanOf: (item: Item) => VocalSecondsSpan,
  minShare: number,
): Item | undefined => {
  let best: Item | undefined = undefined;
  let bestShare = minShare;
  const length = span.end - span.start;
  for (const item of items) {
    const other = spanOf(item);
    const overlap =
      Math.min(span.end, other.end) - Math.max(span.start, other.start);
    const share = overlap / length;
    if (share >= bestShare) {
      best = item;
      bestShare = share;
    }
  }
  return best;
};

const noteMatchShare = 0.5;
const sameNoteCents = 150;
const octaveCents = 1200;

const octaveFolded = (cents: number) =>
  cents - octaveCents * Math.round(cents / octaveCents);

export const longNotes = (voice: VocalVoice, minSeconds: number): VocalNote[] =>
  voice.phrases
    .flatMap((phrase) => phrase.notes)
    .filter(
      (note) => (note.end - note.start) * voice.frames.hopSeconds >= minSeconds,
    );

export type NoteCounterpartInput = {
  lead: VocalVoice;
  note: VocalNote;
  take: VocalVoice;
  takeNotes: readonly VocalNote[];
  anyOctave: boolean;
};

export const findNoteCounterpart = (input: NoteCounterpartInput) => {
  const { lead, note, take, takeNotes, anyOctave } = input;
  return findOverlapping(
    takeNotes.filter((item) => {
      const offset = item.cents - note.cents;
      return (
        Math.abs(anyOctave ? octaveFolded(offset) : offset) <= sameNoteCents
      );
    }),
    spanSeconds(lead, note),
    (item) => spanSeconds(take, item),
    noteMatchShare,
  );
};
