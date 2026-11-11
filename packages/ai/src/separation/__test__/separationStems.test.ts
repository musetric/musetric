import { describe, expect, it } from 'vitest';
import {
  peakScale,
  raisePeaks,
  separateStems,
  silentPeaks,
  stemScales,
} from '../separationStems.js';

describe('separation stems', () => {
  it('subtracts the vocals from the mixture and the backing from the vocals', () => {
    const stems = separateStems({
      vocals: [Float32Array.from([0.5, 0.25]), Float32Array.from([-0.5, 0])],
      backing: [Float32Array.from([0.125, 0]), Float32Array.from([0, 0.5])],
      mixture: [
        Float32Array.from([9, 1, 0.75]),
        Float32Array.from([9, -1, 0.5]),
      ],
      offset: 1,
    });
    expect(Array.from(stems.vocals)).toEqual([0.5, -0.5, 0.25, 0]);
    expect(Array.from(stems.backing)).toEqual([0.125, 0, 0, 0.5]);
    expect(Array.from(stems.instrumental)).toEqual([0.5, -0.5, 0.5, 0.5]);
    expect(Array.from(stems.lead)).toEqual([0.375, -0.5, 0.25, -0.5]);
  });

  it('rounds each difference to float32 as the stored stems were', () => {
    const vocals = Math.fround(0.1);
    const mixture = Math.fround(0.7);
    const stems = separateStems({
      vocals: [Float32Array.of(vocals), Float32Array.of(vocals)],
      backing: [Float32Array.of(0), Float32Array.of(0)],
      mixture: [Float32Array.of(mixture), Float32Array.of(mixture)],
      offset: 0,
    });
    expect(stems.instrumental[0]).toBe(Math.fround(mixture - vocals));
  });

  it('keeps the largest peak of every stem', () => {
    const stems = separateStems({
      vocals: [Float32Array.of(-1.5), Float32Array.of(0.25)],
      backing: [Float32Array.of(0.5), Float32Array.of(0)],
      mixture: [Float32Array.of(0), Float32Array.of(0)],
      offset: 0,
    });
    const peaks = raisePeaks({ ...silentPeaks(), backing: 0.75 }, stems);
    expect(peaks).toEqual({
      vocals: 1.5,
      instrumental: 1.5,
      lead: 2,
      backing: 0.75,
    });
  });

  it('scales a stem down to the peak only when it rises above it', () => {
    expect(peakScale(0)).toBe(1);
    expect(peakScale(0.9)).toBe(1);
    expect(peakScale(1.8)).toBe(0.5);
    expect(
      stemScales({ vocals: 0.5, instrumental: 1.8, lead: 0, backing: 0.9 }),
    ).toEqual({
      vocals: 1,
      instrumental: 0.5,
      lead: 1,
      backing: 1,
    });
  });
});
