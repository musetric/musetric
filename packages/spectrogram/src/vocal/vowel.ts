import { type VocalFrames } from './frames.js';
import { type VocalMarkOf } from './marks.js';
import { findNoteCounterpart, longNotes, spanSeconds } from './match.js';
import { median } from './math.js';
import { type VocalNote } from './segments.js';
import { type VocalVoice } from './voice.js';

const minNoteSeconds = 0.3;
const maxFundamental = 350;
const minSlots = 3;
const bandBase = 250;
const bandsPerOctave = 3;
const bandCount = 11;
const lowerOpenBands = [1, 2, 3];
const upperOpenBands = [4, 5, 6];
const backFrontBands = [6, 7];
const frontBands = [8, 9, 10];
const stepDb = 6;

const bandCenter = (band: number) => bandBase * 2 ** (band / bandsPerOctave);

const interpolateEnvelope = (
  harmonics: Float32Array,
  fundamental: number,
  count: number,
  frequency: number,
) => {
  const position = frequency / fundamental;
  const lower = Math.max(1, Math.min(count - 1, Math.floor(position)));
  const upper = lower + 1;
  const share = Math.min(
    1,
    Math.max(0, Math.log(position / lower) / Math.log(upper / lower)),
  );
  return (
    harmonics[lower - 1] + (harmonics[upper - 1] - harmonics[lower - 1]) * share
  );
};

const noteEnvelope = (
  frames: VocalFrames,
  note: VocalNote,
): number[] | undefined => {
  const bands: number[][] = Array.from({ length: bandCount }, () => []);
  const first = Math.ceil(note.start / frames.spectralStride);
  const last = Math.floor((note.end - 1) / frames.spectralStride);
  for (let slot = first; slot <= last; slot += 1) {
    const fundamental = frames.pitch[slot * frames.spectralStride];
    if (fundamental <= 0 || fundamental > maxFundamental) {
      continue;
    }
    const count = Math.min(
      frames.maxHarmonics,
      Math.floor(frames.maxHarmonicFrequency / fundamental),
    );
    const harmonics = frames.harmonics.subarray(
      slot * frames.maxHarmonics,
      (slot + 1) * frames.maxHarmonics,
    );
    bands.forEach((values, band) => {
      values.push(
        interpolateEnvelope(harmonics, fundamental, count, bandCenter(band)),
      );
    });
  }
  return bands[0].length >= minSlots ? bands.map(median) : undefined;
};

const average = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

const contrast = (
  envelope: readonly number[],
  high: readonly number[],
  low: readonly number[],
) =>
  average(high.map((band) => envelope[band])) -
  average(low.map((band) => envelope[band]));

export type VowelTraits = {
  openDb: number;
  frontDb: number;
};

type VoiceVowels = Map<VocalNote, VowelTraits>;

const measureVoiceVowels = (voice: VocalVoice): VoiceVowels => {
  const envelopes = new Map<VocalNote, number[]>();
  for (const note of longNotes(voice, minNoteSeconds)) {
    const envelope = noteEnvelope(voice.frames, note);
    if (envelope) {
      envelopes.set(note, envelope);
    }
  }
  const usual = Array.from({ length: bandCount }, (_, band) =>
    median([...envelopes.values()].map((envelope) => envelope[band])),
  );
  const vowels: VoiceVowels = new Map();
  for (const [note, envelope] of envelopes) {
    const deviation = envelope.map((value, band) => value - usual[band]);
    vowels.set(note, {
      openDb: contrast(deviation, upperOpenBands, lowerOpenBands),
      frontDb: contrast(deviation, frontBands, backFrontBands),
    });
  }
  return vowels;
};

export type VowelAdvice = 'open' | 'close' | 'front' | 'round';

export const compareVowels = (
  lead: VowelTraits,
  take: VowelTraits,
): VowelAdvice | undefined => {
  const open = lead.openDb - take.openDb;
  const front = lead.frontDb - take.frontDb;
  if (Math.max(Math.abs(open), Math.abs(front)) < stepDb) {
    return undefined;
  }
  if (Math.abs(open) >= Math.abs(front)) {
    return open > 0 ? 'open' : 'close';
  }
  return front > 0 ? 'front' : 'round';
};

export type VowelMark = VocalMarkOf<'vowel', VowelTraits, VowelAdvice>;

export const detectVowels = (
  lead: VocalVoice,
  take: VocalVoice | undefined,
): VowelMark[] => {
  if (!take) {
    return [];
  }
  const leadVowels = measureVoiceVowels(lead);
  const takeVowels = measureVoiceVowels(take);
  const takeNotes = [...takeVowels.keys()];
  const marks: VowelMark[] = [];
  for (const [note, traits] of leadVowels) {
    const counterpart = findNoteCounterpart({
      lead,
      note,
      take,
      takeNotes,
      anyOctave: true,
    });
    const takeTraits = counterpart ? takeVowels.get(counterpart) : undefined;
    const advice = takeTraits ? compareVowels(traits, takeTraits) : undefined;
    if (takeTraits && advice) {
      marks.push({
        kind: 'vowel',
        ...spanSeconds(lead, note),
        status: 'differ',
        advice,
        lead: traits,
        take: takeTraits,
      });
    }
  }
  return marks;
};
