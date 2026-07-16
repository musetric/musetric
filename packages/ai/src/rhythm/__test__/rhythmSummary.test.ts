import { describe, expect, it } from 'vitest';
import { estimateBpm, estimateMeter } from '../rhythmSummary.js';

const steady = (count: number, interval: number): number[] =>
  Array.from({ length: count }, (_ignored, index) => index * interval);

describe('estimateBpm', () => {
  it('reads tempo from the median interval', () => {
    expect(estimateBpm(steady(9, 0.5))).toBeCloseTo(120, 10);
  });

  it('needs at least two beats', () => {
    expect(estimateBpm([])).toBe(0);
    expect(estimateBpm([1])).toBe(0);
  });

  it('ignores an outlier interval once there are enough of them', () => {
    const beats = [0, 0.5, 1, 1.5, 2, 2.5, 3, 30];
    expect(estimateBpm(beats)).toBeCloseTo(120, 10);
  });

  it('keeps the raw intervals when too few to filter', () => {
    expect(estimateBpm([0, 0.5, 1, 10])).toBeCloseTo(120, 10);
  });
});

describe('estimateMeter', () => {
  it('counts beats between consecutive downbeats', () => {
    const beats = steady(17, 0.5);
    const downbeats = [0, 2, 4, 6, 8];
    expect(estimateMeter(beats, downbeats)).toBe(4);
  });

  it('detects a three-beat bar', () => {
    const beats = steady(13, 0.5);
    const downbeats = [0, 1.5, 3, 4.5, 6];
    expect(estimateMeter(beats, downbeats)).toBe(3);
  });

  it('falls back to four without enough downbeats', () => {
    expect(estimateMeter(steady(8, 0.5), [])).toBe(4);
    expect(estimateMeter([], [0, 2])).toBe(4);
  });

  it('rounds a tied median to even, matching python round', () => {
    const beats = steady(5, 0.5);
    const downbeats = [0, 1, 2.5];
    expect(estimateMeter(beats, downbeats)).toBe(2);
  });
});
