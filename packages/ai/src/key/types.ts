export type KeyMode = 'major' | 'minor';

export type KeyResult = {
  root: string;
  mode: KeyMode;
  confidence: number;
};
