import { type api } from '@musetric/api';
import { getActiveChordIndex } from '../chords/chordTiming.js';

export type WordChord = {
  label: string;
  start: number;
  end: number;
};

const isNamedChord = (label: string) => label !== 'N' && label !== 'X';

export const getWordChordLabels = (
  words: api.subtitle.Word[],
  chordSegments: api.chords.ChordSegment[],
): (WordChord | undefined)[] => {
  let previous: string | undefined = undefined;
  return words.map((word) => {
    const index = getActiveChordIndex(chordSegments, word.start);
    const segment =
      index >= 0 && index < chordSegments.length
        ? chordSegments[index]
        : undefined;
    const label =
      segment && isNamedChord(segment.label) ? segment.label : undefined;
    const shown =
      segment && label && label !== previous
        ? { label, start: segment.start, end: segment.end }
        : undefined;
    previous = label;
    return shown;
  });
};
