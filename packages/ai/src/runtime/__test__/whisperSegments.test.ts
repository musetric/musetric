import { describe, expect, it } from 'vitest';
import {
  type HalvesRule,
  joinHalves,
  needsHalves,
  type WordChunk,
} from '../whisper/whisperSegments.js';

const chunk = (text: string, start: number, end: number): WordChunk => ({
  text,
  timestamp: [start, end],
});

describe('needsHalves', () => {
  const rule: HalvesRule = { minSeconds: 12, coverage: 0.6, maxGap: 6 };

  it('flags a long window whose words stop well before its end', () => {
    expect(needsHalves([chunk(' a', 0, 1.5)], 20, rule)).toBe(true);
    expect(needsHalves([], 20, rule)).toBe(true);
  });

  it('flags a long window that skips a stretch between its words', () => {
    expect(
      needsHalves([chunk(' a', 0, 1.5), chunk(' b', 9, 19)], 20, rule),
    ).toBe(true);
  });

  it('keeps a window that is short or decoded through', () => {
    expect(needsHalves([chunk(' a', 0, 1.5)], 10, rule)).toBe(false);
    expect(needsHalves([chunk(' a', 0, 5), chunk(' b', 9, 19)], 20, rule)).toBe(
      false,
    );
  });
});

describe('joinHalves', () => {
  it('moves the second half by its offset', () => {
    expect(
      joinHalves([chunk(' one', 1, 2)], [chunk(' two', 0.5, 0.9)], 10),
    ).toEqual([chunk(' one', 1, 2), chunk(' two', 10.5, 10.9)]);
  });
});
