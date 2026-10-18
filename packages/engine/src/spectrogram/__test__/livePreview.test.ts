import { describe, expect, it } from 'vitest';
import { toContextRate } from '../livePreview.cross.js';

describe('toContextRate', () => {
  it('copies samples captured at the context rate', () => {
    const samples = Float32Array.from([1, 2, 3]);
    const result = toContextRate(samples, 48000, 48000);
    expect(Array.from(result)).toEqual([1, 2, 3]);
    expect(result).not.toBe(samples);
  });

  it('interpolates samples captured at another rate', () => {
    const samples = Float32Array.from([0, 2, 4, 6]);
    expect(Array.from(toContextRate(samples, 24000, 48000))).toEqual([
      0, 1, 2, 3, 4, 5, 6, 6,
    ]);
    expect(Array.from(toContextRate(samples, 48000, 24000))).toEqual([0, 4]);
  });
});
