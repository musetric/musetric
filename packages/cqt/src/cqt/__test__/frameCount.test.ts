import { describe, expect, it } from 'vitest';
import { getCqtFrameCount } from '../frameCount.es.js';
import { getReferencePlan } from './plan.js';

const plan = getReferencePlan();

describe('CQT frame count', () => {
  it.each([0, 1])(
    'rejects inputs shorter than the early downsample factor: %i',
    (sampleCount) => {
      expect(() => getCqtFrameCount(sampleCount, plan)).toThrow(RangeError);
    },
  );

  it.each([
    [2, 1],
    [2046, 1],
    [2047, 2],
    [2048, 2],
    [2049, 2],
    [4095, 3],
  ])(
    'matches librosa recursive frame count for %i samples',
    (sampleCount, expected) => {
      expect(getCqtFrameCount(sampleCount, plan)).toBe(expected);
    },
  );
});
