import { type PayloadSegment } from '../../transcription/types.js';

const fnvOffset = 0x811c9dc5;
const fnvPrime = 0x01000193;

export const wordHash = (text: string): number => {
  const letters =
    text
      .toLowerCase()
      .match(/[\p{L}\p{N}]/gu)
      ?.join('') ?? '';
  let value = fnvOffset | 0;
  for (const byte of new TextEncoder().encode(letters)) {
    value = Math.imul(value ^ byte, fnvPrime);
  }
  return value;
};

type LineWord = { text: string; start: number; end: number };

const rows = (
  words: LineWord[],
  time: (word: LineWord) => number,
): Int32Array => {
  const values = new Int32Array(words.length * 2);
  for (const [index, word] of words.entries()) {
    values[index * 2] = wordHash(word.text);
    values[index * 2 + 1] = Math.round(time(word) * 1000);
  }
  return values;
};

export const lineWordRows = (lines: PayloadSegment[]): Int32Array =>
  rows(
    lines.flatMap((line) => line.words),
    (word) => word.start,
  );

export const lineBreakRows = (lines: PayloadSegment[]): Int32Array =>
  rows(
    lines.flatMap((line) => line.words.slice(-1)),
    (word) => word.end,
  );
