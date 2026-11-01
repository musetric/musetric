import { type Chunk } from './audioCompaction.js';
import { sampleRate } from './spectralChunker.js';
import { type TranscriptionWord } from './types.js';

const minStyledWords = 6;
const promptWords = 25;
const minWordMatch = 0.7;

const textOf = (words: TranscriptionWord[]): string =>
  words
    .map((word) => word.text.trim())
    .filter(Boolean)
    .join(' ');

const countWords = (text: string): number =>
  text.split(/\s+/u).filter(Boolean).length;

const stop = /[.!?]/u;

const hasCapitalAfterStart = (text: string): boolean =>
  /\p{Lu}/u.test(Array.from(text).slice(1).join(''));

export const isFlat = (text: string): boolean =>
  countWords(text) >= minStyledWords &&
  !hasCapitalAfterStart(text) &&
  !stop.test(text);

const isPunctuated = (text: string): boolean =>
  countWords(text) >= minStyledWords && !isFlat(text) && stop.test(text);

const matchableWords = (text: string): string[] =>
  text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

export const wordMatch = (first: string, second: string): number => {
  const a = matchableWords(first);
  const b = matchableWords(second);
  if (a.length + b.length === 0) {
    return 0;
  }
  let previous = new Array<number>(b.length + 1).fill(0);
  for (const word of a) {
    const row = new Array<number>(b.length + 1).fill(0);
    for (const [index, other] of b.entries()) {
      row[index + 1] =
        word === other
          ? previous[index] + 1
          : Math.max(previous[index + 1], row[index]);
    }
    previous = row;
  }
  return (2 * previous[b.length]) / (a.length + b.length);
};

export type FlatRepairOptions = {
  compacted: Float32Array;
  chunks: Chunk[];
  wordsPerChunk: TranscriptionWord[][];
  transcribeSlice: (
    audio: Float32Array,
    prompt: string,
  ) => Promise<TranscriptionWord[]>;
};

export const repairFlatWindows = async (
  options: FlatRepairOptions,
): Promise<TranscriptionWord[][]> => {
  const { compacted, chunks, wordsPerChunk, transcribeSlice } = options;
  const texts = wordsPerChunk.map(textOf);
  const punctuated = texts.flatMap((text, index) =>
    isPunctuated(text) ? [index] : [],
  );
  if (punctuated.length === 0) {
    return wordsPerChunk;
  }
  const result = [...wordsPerChunk];
  for (const [index, text] of texts.entries()) {
    if (!isFlat(text)) {
      continue;
    }
    const nearest = punctuated.reduce(
      (best, candidate) =>
        Math.abs(candidate - index) < Math.abs(best - index) ? candidate : best,
      punctuated[0],
    );
    const { start, end } = chunks[index];
    const words = await transcribeSlice(
      compacted.subarray(
        Math.round(start * sampleRate),
        Math.round(end * sampleRate),
      ),
      textOf(wordsPerChunk[nearest].slice(-promptWords)),
    );
    const repaired = textOf(words);
    if (!isFlat(repaired) && wordMatch(text, repaired) >= minWordMatch) {
      result[index] = words.map((word) => ({
        text: word.text,
        start: word.start + start,
        end: word.end + start,
      }));
    }
  }
  return result;
};
