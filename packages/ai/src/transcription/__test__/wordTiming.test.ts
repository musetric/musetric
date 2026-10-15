import { describe, expect, it } from 'vitest';
import { leadWordTimes } from '../wordTiming.js';

describe('leadWordTimes', () => {
  it('moves a word start earlier the longer the word is sung', () => {
    const [segment] = leadWordTimes([
      {
        start: 1,
        end: 4.5,
        text: 'short long',
        words: [
          { text: 'short', start: 1, end: 1.2 },
          { text: 'long', start: 2, end: 4.5 },
        ],
      },
    ]);
    expect(segment.words?.[0].start).toBeCloseTo(0.86);
    expect(segment.words?.[1].start).toBeCloseTo(1.7);
    expect(segment.words?.[0].end).toBeCloseTo(1.05);
    expect(segment.words?.[1].end).toBeCloseTo(4.35);
    expect(segment.start).toBeCloseTo(0.86);
    expect(segment.end).toBeCloseTo(4.35);
  });

  it('never moves a time below zero or an end before its start', () => {
    const [segment] = leadWordTimes([
      {
        start: 0.05,
        end: 0.05,
        text: 'tick',
        words: [{ text: 'tick', start: 0.05, end: 0.05 }],
      },
    ]);
    expect(segment.words).toEqual([{ text: 'tick', start: 0, end: 0 }]);
  });
});
