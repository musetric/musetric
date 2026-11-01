import { describe, expect, it } from 'vitest';
import { lineBreakRows, lineWordRows, wordHash } from './parityLineRows.js';

const word = (text: string, start: number, end: number) => ({
  text,
  start,
  end,
});

const lines = [
  {
    start: 1,
    end: 2,
    text: 'Bad side,',
    words: [word('Bad', 1, 1.5), word('side,', 1.5, 2)],
  },
  { start: 3, end: 4, text: 'again', words: [word('again', 3, 4)] },
];

describe('wordHash', () => {
  it('ignores case and punctuation', () => {
    expect(wordHash('Side,')).toBe(wordHash('side'));
    expect(wordHash("don't")).toBe(wordHash('DONT'));
  });

  it('tells words apart and gives the known FNV-1a value', () => {
    expect(wordHash('side')).not.toBe(wordHash('sides'));
    expect(wordHash('a')).toBe(0xe40c292c | 0);
    expect(wordHash('')).toBe(0x811c9dc5 | 0);
  });

  it('hashes bytes, not characters, outside ASCII', () => {
    const small = String.fromCodePoint(0xe9);
    const capital = String.fromCodePoint(0xc9);
    expect(wordHash(small)).toBe(wordHash(capital));
    expect(wordHash(small)).not.toBe(wordHash('e'));
  });
});

describe('line rows', () => {
  it('lists every word with its start in milliseconds', () => {
    expect([...lineWordRows(lines)]).toEqual([
      wordHash('bad'),
      1000,
      wordHash('side'),
      1500,
      wordHash('again'),
      3000,
    ]);
  });

  it('lists the last word of each line with its end', () => {
    expect([...lineBreakRows(lines)]).toEqual([
      wordHash('side'),
      2000,
      wordHash('again'),
      4000,
    ]);
  });
});
