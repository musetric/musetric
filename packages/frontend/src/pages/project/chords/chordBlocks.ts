import { type api } from '@musetric/api';
import { transposeKeyRoot } from '../key/keyFormat.js';

const qualitySuffixes = new Map<string, string>([
  ['maj', ''],
  ['min', 'm'],
  ['dim', 'dim'],
  ['aug', 'aug'],
  ['min6', 'm6'],
  ['maj6', '6'],
  ['min7', 'm7'],
  ['minmaj7', 'mMaj7'],
  ['maj7', 'maj7'],
  ['7', '7'],
  ['dim7', 'dim7'],
  ['hdim7', 'm7b5'],
  ['sus2', 'sus2'],
  ['sus4', 'sus4'],
]);

const isNamedChord = (segment: api.chords.ChordSegment): boolean =>
  segment.label !== 'N' && segment.label !== 'X';

const formatChord = (
  segment: api.chords.ChordSegment,
  semitones: number,
): string => {
  const root = transposeKeyRoot(segment.root, semitones);
  const quality = segment.quality ?? 'maj';
  const suffix = qualitySuffixes.get(quality) ?? `:${quality}`;
  return `${root}${suffix}`;
};

export type ChordBlock = {
  start: number;
  end: number;
  label: string;
};

export const getChordBlocks = (
  segments: api.chords.ChordSegment[],
  semitones: number,
): ChordBlock[] =>
  segments.filter(isNamedChord).map((segment) => ({
    start: segment.start,
    end: segment.end,
    label: formatChord(segment, semitones),
  }));

export const findChordBlockIndex = (
  blocks: ChordBlock[],
  time: number,
): number => {
  let low = 0;
  let high = blocks.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (time < blocks[middle].end) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return low < blocks.length && blocks[low].start <= time ? low : -1;
};
