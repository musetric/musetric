import { type TranscriptionWord } from './types.js';

const bunchMinWords = 3;
const bunchToleranceSeconds = 0.02;

const atPoint = (word: TranscriptionWord, point: number): boolean =>
  Math.abs(word.start - point) <= bunchToleranceSeconds &&
  Math.abs(word.end - point) <= bunchToleranceSeconds;

export const dropBunchedWords = (
  words: TranscriptionWord[],
): TranscriptionWord[] => {
  const kept: TranscriptionWord[] = [];
  let from = 0;
  while (from < words.length) {
    const point = words[from].start;
    let to = from;
    while (to < words.length && atPoint(words[to], point)) {
      to += 1;
    }
    if (to - from >= bunchMinWords) {
      from = to;
      continue;
    }
    kept.push(words[from]);
    from += 1;
  }
  return kept;
};
