import { describe, expect, it } from 'vitest';
import { type TranscriptionWord } from '../types.js';
import { joinWordPieces } from '../wordPieces.js';

const words = (texts: string[]): TranscriptionWord[] =>
  texts.map((text, index) => ({ text, start: index, end: index + 1 }));

const texts = (joined: TranscriptionWord[]): string[] =>
  joined.map((word) => word.text);

describe('joinWordPieces', () => {
  it('joins a piece that starts with an apostrophe to the word before', () => {
    expect(joinWordPieces(words(['J', "'ai", 'vu', 'l', '’eau']))).toEqual([
      { text: "J'ai", start: 0, end: 2 },
      { text: 'vu', start: 2, end: 3 },
      { text: 'l’eau', start: 3, end: 5 },
    ]);
  });

  it('joins a piece that starts with a hyphen', () => {
    expect(texts(joinWordPieces(words(['по', '-моему', 'да'])))).toEqual([
      'по-моему',
      'да',
    ]);
  });

  it('leaves a lone dash and an opening piece alone', () => {
    expect(texts(joinWordPieces(words(["'til", 'now', '-', 'go'])))).toEqual([
      "'til",
      'now',
      '-',
      'go',
    ]);
  });
});
