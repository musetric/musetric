import { type KeyMode } from './types.js';

export type KeyLabel = {
  root: string;
  mode: KeyMode;
};

export const keyMap: readonly KeyLabel[] = [
  { root: 'A', mode: 'major' },
  { root: 'Bb', mode: 'major' },
  { root: 'B', mode: 'major' },
  { root: 'C', mode: 'major' },
  { root: 'C#', mode: 'major' },
  { root: 'D', mode: 'major' },
  { root: 'D#', mode: 'major' },
  { root: 'E', mode: 'major' },
  { root: 'F', mode: 'major' },
  { root: 'F#', mode: 'major' },
  { root: 'G', mode: 'major' },
  { root: 'G#', mode: 'major' },
  { root: 'B', mode: 'minor' },
  { root: 'C', mode: 'minor' },
  { root: 'C#', mode: 'minor' },
  { root: 'D', mode: 'minor' },
  { root: 'D#', mode: 'minor' },
  { root: 'E', mode: 'minor' },
  { root: 'F', mode: 'minor' },
  { root: 'F#', mode: 'minor' },
  { root: 'G', mode: 'minor' },
  { root: 'G#', mode: 'minor' },
  { root: 'A', mode: 'minor' },
  { root: 'Bb', mode: 'minor' },
];
