import { describe, expect, it } from 'vitest';
import { splitSegmentsByLyrics } from '../lyricSplitter.js';
import { buildPayloadSegments } from '../responseBuilder.js';
import { type TranscriptionSegment } from '../types.js';

const word = (text: string, start: number, end: number) => ({
  text,
  start,
  end,
});

describe('splitSegmentsByLyrics', () => {
  it('splits a segment at a capitalized phrase after strong punctuation', () => {
    const segments: TranscriptionSegment[] = [
      {
        start: 0,
        end: 4,
        text: 'Hello there. Goodbye now',
        words: [
          word('Hello', 0, 0.5),
          word('there.', 0.5, 1.0),
          word('Goodbye', 1.2, 1.8),
          word('now', 1.8, 2.2),
        ],
      },
    ];
    const split = splitSegmentsByLyrics(segments);
    expect(split.map((s) => s.text)).toEqual(['Hello there.', 'Goodbye now']);
    expect(split[1].start).toBeCloseTo(1.2, 5);
    expect(split[1].end).toBeCloseTo(2.2, 5);
  });

  it('splits after strong punctuation before a lowercase word', () => {
    const words = ['one', 'two.', 'three', 'four'].map((text, index) =>
      word(text, index, index + 0.9),
    );
    const split = splitSegmentsByLyrics([
      { start: 0, end: 3.9, text: 'one two. three four', words },
    ]);
    expect(split.map((s) => s.text)).toEqual(['one two.', 'three four']);
  });

  it('splits after a comma only once the line is long', () => {
    const texts = ['a', 'b', 'c', 'd', 'e,', 'f,', 'g', 'h,', 'i'];
    const words = texts.map((text, index) =>
      word(text, index * 0.3, index * 0.3 + 0.25),
    );
    const split = splitSegmentsByLyrics([
      { start: 0, end: 2.65, text: texts.join(' '), words },
    ]);
    expect(split.map((s) => s.text)).toEqual(['a b c d e, f,', 'g h, i']);
  });

  it('keeps a single short line intact', () => {
    const segments: TranscriptionSegment[] = [
      {
        start: 0,
        end: 1,
        text: 'just one line',
        words: [
          word('just', 0, 0.3),
          word('one', 0.3, 0.6),
          word('line', 0.6, 1),
        ],
      },
    ];
    expect(splitSegmentsByLyrics(segments).map((s) => s.text)).toEqual([
      'just one line',
    ]);
  });

  it('drops empty segments', () => {
    const segments: TranscriptionSegment[] = [{ start: 0, end: 1, text: '  ' }];
    expect(splitSegmentsByLyrics(segments)).toEqual([]);
  });
});

describe('buildPayloadSegments', () => {
  it('emits words and falls back to a whole-segment word', () => {
    const segments: TranscriptionSegment[] = [
      {
        start: 0,
        end: 1,
        text: 'with words',
        words: [word('with', 0, 0.4), word('words', 0.4, 1)],
      },
      { start: 1, end: 2, text: 'no words' },
    ];
    const payload = buildPayloadSegments(segments);
    expect(payload[0].words).toEqual([
      { start: 0, end: 0.4, text: 'with' },
      { start: 0.4, end: 1, text: 'words' },
    ]);
    expect(payload[1].words).toEqual([{ start: 1, end: 2, text: 'no words' }]);
  });
});
