import { type VocalFrames } from './frames.js';
import { type VocalMarkOf } from './marks.js';
import { findNoteCounterpart, longNotes, spanSeconds } from './match.js';
import { median } from './math.js';
import { type VocalNote } from './segments.js';
import { type VocalVoice } from './voice.js';

const minNoteSeconds = 0.3;
const minSlots = 3;
const quietBelowDb = 20;
const minSpreadDb = 0.5;
const styleSpreads = 1.5;
const plainSpreads = 0.5;
const traitSpreads = 2;

const noteCpp = (
  frames: VocalFrames,
  note: VocalNote,
  quiet: number,
): number | undefined => {
  const values: number[] = [];
  const first = Math.ceil(note.start / frames.spectralStride);
  const last = Math.floor((note.end - 1) / frames.spectralStride);
  for (let slot = first; slot <= last; slot += 1) {
    const index = slot * frames.spectralStride;
    if (frames.pitch[index] > 0 && frames.body[index] >= quiet) {
      values.push(frames.cpp[slot]);
    }
  }
  return values.length >= minSlots ? median(values) : undefined;
};

export type AirTraits = {
  cppDb: number;
  relativeDb: number;
  spreadDb: number;
};

type VoiceAir = Map<VocalNote, AirTraits>;

const measureVoiceAir = (voice: VocalVoice): VoiceAir => {
  const notes = longNotes(voice, minNoteSeconds);
  const voiced = Array.from(voice.frames.body).filter(
    (_, index) => voice.frames.pitch[index] > 0,
  );
  const quiet = median(voiced) - quietBelowDb;
  const values = new Map<VocalNote, number>();
  for (const note of notes) {
    const value = noteCpp(voice.frames, note, quiet);
    if (value !== undefined) {
      values.set(note, value);
    }
  }
  const usual = median([...values.values()]);
  const spreadDb = Math.max(
    minSpreadDb,
    median([...values.values()].map((value) => Math.abs(value - usual))),
  );
  const air: VoiceAir = new Map();
  for (const [note, cppDb] of values) {
    air.set(note, { cppDb, relativeDb: cppDb - usual, spreadDb });
  }
  return air;
};

const spreads = (traits: AirTraits) => traits.relativeDb / traits.spreadDb;

export type AirAdvice = 'moreAir' | 'lessAir';

export const compareAir = (
  lead: AirTraits,
  take: AirTraits,
): AirAdvice | undefined => {
  if (spreads(lead) <= -styleSpreads && spreads(take) >= -plainSpreads) {
    return 'moreAir';
  }
  if (spreads(lead) >= styleSpreads && spreads(take) <= plainSpreads) {
    return 'lessAir';
  }
  return undefined;
};

const traitAdvice = (lead: AirTraits): AirAdvice | undefined => {
  if (spreads(lead) <= -traitSpreads) {
    return 'moreAir';
  }
  return spreads(lead) >= traitSpreads ? 'lessAir' : undefined;
};

export type AirMark = VocalMarkOf<'air', AirTraits, AirAdvice>;

const takeMark = (
  span: Pick<AirMark, 'start' | 'end'>,
  lead: AirTraits,
  take: AirTraits,
): AirMark | undefined => {
  const advice = compareAir(lead, take);
  if (!advice && !traitAdvice(lead)) {
    return undefined;
  }
  return {
    kind: 'air',
    ...span,
    status: advice ? 'differ' : 'match',
    advice: advice ?? traitAdvice(lead),
    lead,
    take,
  };
};

export const detectAirs = (
  lead: VocalVoice,
  take: VocalVoice | undefined,
): AirMark[] => {
  const leadAir = measureVoiceAir(lead);
  const takeAir = take
    ? measureVoiceAir(take)
    : new Map<VocalNote, AirTraits>();
  const takeNotes = [...takeAir.keys()];
  const marks: AirMark[] = [];
  for (const [note, traits] of leadAir) {
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
    const takeTraits = counterpart ? takeAir.get(counterpart) : undefined;
    const mark = takeTraits ? takeMark(span, traits, takeTraits) : undefined;
    const advice = traitAdvice(traits);
    if (mark) {
      marks.push(mark);
    } else if (!takeTraits && advice) {
      marks.push({
        kind: 'air',
        ...span,
        status: 'trait',
        advice,
        lead: traits,
      });
    }
  }
  return marks;
};
