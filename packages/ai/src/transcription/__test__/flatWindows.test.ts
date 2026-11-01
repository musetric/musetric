import { describe, expect, it } from 'vitest';
import { isFlat, repairFlatWindows, wordMatch } from '../flatWindows.js';
import { sampleRate } from '../spectralChunker.js';
import { type TranscriptionWord } from '../types.js';

const wordsOf = (text: string, start = 0): TranscriptionWord[] =>
  text.split(' ').map((word, index) => ({
    text: word,
    start: start + index,
    end: start + index + 0.5,
  }));

const flat = 'we walk along the river until the morning comes';
const flatStyled = 'We walk along the river. Until the morning comes.';
const normal = 'The sun is high. The road is long and I am tired.';

type Call = { samples: number; prompt: string };

type Repaired = { result: TranscriptionWord[][]; calls: Call[] };

const repair = async (
  wordsPerChunk: TranscriptionWord[][],
  decoded: string,
): Promise<Repaired> => {
  const calls: Call[] = [];
  const result = await repairFlatWindows({
    compacted: new Float32Array(30 * sampleRate),
    chunks: wordsPerChunk.map((_, index) => ({
      start: index * 10,
      end: (index + 1) * 10,
      segments: [],
    })),
    wordsPerChunk,
    transcribeSlice: async (audio, prompt) => {
      calls.push({ samples: audio.length, prompt });
      return Promise.resolve(wordsOf(decoded));
    },
  });
  return { result, calls };
};

describe('isFlat', () => {
  it('takes a long text without capitals and stops as flat', () => {
    expect(isFlat(flat)).toBe(true);
    expect(isFlat('We walk along the river until the morning comes')).toBe(
      true,
    );
  });

  it('keeps a styled or short text out', () => {
    expect(isFlat(flatStyled)).toBe(false);
    expect(isFlat('we walk along the River until morning')).toBe(false);
    const cyrillicCapital = String.fromCodePoint(0x420);
    expect(
      isFlat(`we walk along the ${cyrillicCapital}iver until morning`),
    ).toBe(false);
    expect(isFlat('too short to tell')).toBe(false);
  });
});

describe('wordMatch', () => {
  it('ignores case and punctuation', () => {
    expect(wordMatch(flat, flatStyled)).toBe(1);
  });

  it('falls with the words that differ', () => {
    expect(wordMatch('a b c d', 'a b x y')).toBe(0.5);
    expect(wordMatch('', '')).toBe(0);
  });
});

describe('repairFlatWindows', () => {
  it('decodes a flat window with the end of the nearest punctuated one', async () => {
    const { result, calls } = await repair(
      [wordsOf(normal), wordsOf(flat, 10), wordsOf('la la', 20)],
      flatStyled,
    );
    expect(calls).toEqual([{ samples: 10 * sampleRate, prompt: normal }]);
    expect(result[1].map((word) => word.text).join(' ')).toBe(flatStyled);
    expect(result[1][0].start).toBe(10);
  });

  it('keeps the first decode when the new one is still flat', async () => {
    const original = [wordsOf(normal), wordsOf(flat, 10)];
    const { result } = await repair(original, flat);
    expect(result[1]).toBe(original[1]);
  });

  it('keeps the first decode when the words moved too far', async () => {
    const original = [wordsOf(normal), wordsOf(flat, 10)];
    const { result } = await repair(
      original,
      'Something else entirely was heard here tonight.',
    );
    expect(result[1]).toBe(original[1]);
  });

  it('asks nothing of a song without a punctuated window', async () => {
    const original = [wordsOf(flat), wordsOf(flat, 10)];
    const { result, calls } = await repair(original, flatStyled);
    expect(calls).toEqual([]);
    expect(result).toBe(original);
  });
});
