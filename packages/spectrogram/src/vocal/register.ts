import { type VocalFrames } from './frames.js';
import { type VocalMarkOf } from './marks.js';
import { findNoteCounterpart, longNotes, spanSeconds } from './match.js';
import { median } from './math.js';
import { type VocalNote } from './segments.js';
import { type VocalVoice } from './voice.js';

const minNoteSeconds = 0.25;
const minFundamental = 200;
const traitFundamental = 330;
const minSlots = 3;
const upperFirst = 3;
const upperLast = 8;

const lightGapDb = 12;
const fullGapDb = 3;
const stepDb = 8;

export type RegisterTraits = {
  fundamental: number;
  firstOverSecondDb: number;
  upperDb: number;
};

type RegisterLevel = 'full' | 'mixed' | 'light';

const levelOf = (traits: RegisterTraits): RegisterLevel => {
  if (traits.firstOverSecondDb >= lightGapDb) {
    return 'light';
  }
  return traits.firstOverSecondDb <= fullGapDb ? 'full' : 'mixed';
};

const powerSum = (decibels: readonly number[]) =>
  10 * Math.log10(decibels.reduce((sum, value) => sum + 10 ** (value / 10), 0));

export const measureRegister = (
  frames: VocalFrames,
  note: VocalNote,
): RegisterTraits | undefined => {
  const gaps: number[] = [];
  const uppers: number[] = [];
  const fundamentals: number[] = [];
  const first = Math.ceil(note.start / frames.spectralStride);
  const last = Math.floor((note.end - 1) / frames.spectralStride);
  for (let slot = first; slot <= last; slot += 1) {
    const fundamental = frames.pitch[slot * frames.spectralStride];
    if (fundamental <= 0) {
      continue;
    }
    const harmonics = frames.harmonics.subarray(
      slot * frames.maxHarmonics,
      (slot + 1) * frames.maxHarmonics,
    );
    gaps.push(harmonics[0] - harmonics[1]);
    const upperCount = Math.min(
      upperLast,
      Math.floor(frames.maxHarmonicFrequency / fundamental),
    );
    uppers.push(
      powerSum(Array.from(harmonics.subarray(upperFirst - 1, upperCount))) -
        harmonics[0],
    );
    fundamentals.push(fundamental);
  }
  const fundamental = median(fundamentals);
  if (gaps.length < minSlots || fundamental < minFundamental) {
    return undefined;
  }
  return {
    fundamental,
    firstOverSecondDb: median(gaps),
    upperDb: median(uppers),
  };
};

export type RegisterAdvice = 'fuller' | 'lighter';

export const compareRegisters = (
  lead: RegisterTraits,
  take: RegisterTraits,
): RegisterAdvice | undefined => {
  const leadLevel = levelOf(lead);
  const takeLevel = levelOf(take);
  const gap = take.firstOverSecondDb - lead.firstOverSecondDb;
  if (leadLevel === takeLevel || Math.abs(gap) < stepDb) {
    return undefined;
  }
  return gap > 0 ? 'fuller' : 'lighter';
};

const traitAdvice = (lead: RegisterTraits): RegisterAdvice | undefined => {
  if (lead.fundamental < traitFundamental) {
    return undefined;
  }
  const level = levelOf(lead);
  if (level === 'full') {
    return 'fuller';
  }
  return level === 'light' ? 'lighter' : undefined;
};

export type RegisterMark = VocalMarkOf<
  'register',
  RegisterTraits,
  RegisterAdvice
>;

const takeMark = (
  span: Pick<RegisterMark, 'start' | 'end'>,
  lead: RegisterTraits,
  take: RegisterTraits,
): RegisterMark | undefined => {
  const advice = compareRegisters(lead, take);
  if (!advice && !traitAdvice(lead)) {
    return undefined;
  }
  return {
    kind: 'register',
    ...span,
    status: advice ? 'differ' : 'match',
    advice: advice ?? traitAdvice(lead),
    lead,
    take,
  };
};

export const detectRegisters = (
  lead: VocalVoice,
  take: VocalVoice | undefined,
): RegisterMark[] => {
  const takeNotes = take ? longNotes(take, minNoteSeconds) : [];
  const marks: RegisterMark[] = [];
  for (const note of longNotes(lead, minNoteSeconds)) {
    const traits = measureRegister(lead.frames, note);
    if (!traits) {
      continue;
    }
    const span = spanSeconds(lead, note);
    const counterpart = take
      ? findNoteCounterpart({
          lead,
          note,
          take,
          takeNotes,
          anyOctave: false,
        })
      : undefined;
    const takeTraits =
      take && counterpart
        ? measureRegister(take.frames, counterpart)
        : undefined;
    const mark = takeTraits ? takeMark(span, traits, takeTraits) : undefined;
    const advice = traitAdvice(traits);
    if (mark) {
      marks.push(mark);
    } else if (!takeTraits && advice) {
      marks.push({
        kind: 'register',
        ...span,
        status: 'trait',
        advice,
        lead: traits,
      });
    }
  }
  return marks;
};
