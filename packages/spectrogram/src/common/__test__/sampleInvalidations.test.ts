import { describe, expect, it } from 'vitest';
import {
  mergeSampleInvalidation,
  type SpectrogramSampleInvalidation,
} from '../sampleInvalidations.js';

const lead = (
  frameIndex: number,
  frameCount: number,
): SpectrogramSampleInvalidation => ({
  trackKey: 'lead',
  frameIndex,
  frameCount,
});

const recording = (
  frameIndex: number,
  frameCount: number,
): SpectrogramSampleInvalidation => ({
  trackKey: 'recording',
  frameIndex,
  frameCount,
});

describe('mergeSampleInvalidation', () => {
  it('appends a disjoint range', () => {
    const pending = [lead(0, 10)];
    expect(mergeSampleInvalidation(pending, lead(20, 5))).toEqual([
      lead(0, 10),
      lead(20, 5),
    ]);
  });

  it('drops empty and negative ranges', () => {
    const pending = [lead(0, 10)];
    expect(mergeSampleInvalidation(pending, lead(20, 0))).toEqual(pending);
    expect(mergeSampleInvalidation(pending, lead(20, -5))).toEqual(pending);
  });

  it('merges an overlapping range of the same track', () => {
    const pending = [lead(0, 10)];
    expect(mergeSampleInvalidation(pending, lead(5, 10))).toEqual([
      lead(0, 15),
    ]);
  });

  it('merges a touching range of the same track', () => {
    const pending = [lead(0, 10)];
    expect(mergeSampleInvalidation(pending, lead(10, 5))).toEqual([
      lead(0, 15),
    ]);
  });

  it('keeps ranges of different tracks separate', () => {
    const pending = [lead(0, 10)];
    expect(mergeSampleInvalidation(pending, recording(5, 10))).toEqual([
      lead(0, 10),
      recording(5, 10),
    ]);
  });

  it('bridges several pending ranges into one', () => {
    const pending = [lead(0, 10), recording(0, 5), lead(20, 10)];
    expect(mergeSampleInvalidation(pending, lead(8, 14))).toEqual([
      recording(0, 5),
      lead(0, 30),
    ]);
  });

  it('leaves the input array untouched', () => {
    const pending = [lead(0, 10)];
    mergeSampleInvalidation(pending, lead(5, 10));
    expect(pending).toEqual([lead(0, 10)]);
  });
});
