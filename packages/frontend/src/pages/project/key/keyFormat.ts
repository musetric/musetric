const keyRoots = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
];

const rootAliases: Record<string, string> = {
  Bb: 'A#',
  Db: 'C#',
  Eb: 'D#',
  Gb: 'F#',
  Ab: 'G#',
};

const getKeyIndex = (root: string): number => {
  const normalized = rootAliases[root] ?? root;
  return keyRoots.indexOf(normalized);
};

export const transposeKeyRoot = (root: string, semitones: number): string => {
  const idx = getKeyIndex(root);
  if (idx < 0) {
    return root;
  }
  const newIdx = (((idx + semitones) % 12) + 12) % 12;
  return keyRoots[newIdx];
};

export const formatKeyCompact = (
  root: string,
  mode: 'major' | 'minor',
): string => (mode === 'minor' ? `${root}m` : `${root}maj`);
