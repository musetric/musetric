import { type AirMark, detectAirs } from './air.js';
import { detectDynamics, type DynamicsMark } from './dynamics.js';
import { detectOnsets, type OnsetMark } from './onset.js';
import { detectRegisters, type RegisterMark } from './register.js';
import { detectReleases, type ReleaseMark } from './release.js';
import { detectTimings, type TimingMark } from './timing.js';
import { detectTransitions, type TransitionMark } from './transition.js';
import { detectVibratos, type VibratoMark } from './vibrato.js';
import { type VocalVoice } from './voice.js';
import { detectVowels, type VowelMark } from './vowel.js';

export type VocalMarkMap = {
  vowel: VowelMark;
  air: AirMark;
  dynamics: DynamicsMark;
  timing: TimingMark;
  register: RegisterMark;
  transition: TransitionMark;
  vibrato: VibratoMark;
  release: ReleaseMark;
  onset: OnsetMark;
};

export type VocalMarkKind = keyof VocalMarkMap;

export const vocalMarkKinds: readonly VocalMarkKind[] = [
  'onset',
  'release',
  'vibrato',
  'transition',
  'register',
  'timing',
  'dynamics',
  'air',
  'vowel',
];

export const mapVocalMarkKinds = <Value>(
  fn: (kind: VocalMarkKind) => Value,
): Record<VocalMarkKind, Value> => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const result = {} as Record<VocalMarkKind, Value>;
  for (const kind of vocalMarkKinds) {
    result[kind] = fn(kind);
  }
  return result;
};

type VocalDetectors = {
  [Kind in VocalMarkKind]: (
    lead: VocalVoice,
    take: VocalVoice | undefined,
  ) => VocalMarkMap[Kind][];
};

const vocalDetectors: VocalDetectors = {
  vowel: detectVowels,
  air: detectAirs,
  dynamics: detectDynamics,
  timing: detectTimings,
  register: detectRegisters,
  transition: detectTransitions,
  vibrato: detectVibratos,
  release: detectReleases,
  onset: detectOnsets,
};

export type VocalMark = VocalMarkMap[VocalMarkKind];

export const detectVocalMarks = (
  lead: VocalVoice,
  take: VocalVoice | undefined,
): VocalMark[] =>
  vocalMarkKinds
    .flatMap((kind): VocalMark[] => vocalDetectors[kind](lead, take))
    .toSorted((left, right) => left.start - right.start);
