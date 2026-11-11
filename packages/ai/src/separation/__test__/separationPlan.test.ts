import { describe, expect, it } from 'vitest';
import {
  planSeparation,
  reachedFrames,
  type SeparationGeometry,
  separationStep,
  settledFrames,
} from '../separationPlan.js';

const chunk = 484_659;
const step = 352_800;
const geometry: SeparationGeometry = {
  sampleRate: 44_100,
  chunkSamples: chunk,
};

describe('planSeparation', () => {
  it('steps by eight seconds of the model rate', () => {
    expect(separationStep(geometry)).toBe(step);
    expect(separationStep({ sampleRate: 44_100, chunkSamples: 1_000 })).toBe(
      1_000,
    );
  });

  it('covers a track shorter than one window once', () => {
    expect(planSeparation(geometry, 1_000)).toEqual([
      { start: 0, length: 1_000 },
    ]);
  });

  it('covers exactly one window twice without a shift', () => {
    expect(planSeparation(geometry, chunk)).toEqual([
      { start: 0, length: chunk },
      { start: 0, length: chunk },
    ]);
  });

  it('shifts the last window back by one frame', () => {
    expect(planSeparation(geometry, chunk + 1)).toEqual([
      { start: 0, length: chunk },
      { start: 1, length: chunk },
    ]);
  });

  it('stops on a step boundary', () => {
    expect(planSeparation(geometry, step)).toEqual([
      { start: 0, length: step },
    ]);
  });

  it('repeats the window on a short track', () => {
    expect(planSeparation(geometry, 400_000)).toEqual([
      { start: 0, length: 400_000 },
      { start: 0, length: 400_000 },
    ]);
  });

  it('repeats the shifted last window until the track ends', () => {
    const frames = 805_600;
    expect(planSeparation(geometry, frames)).toEqual([
      { start: 0, length: chunk },
      { start: frames - chunk, length: chunk },
      { start: frames - chunk, length: chunk },
    ]);
  });

  it('counts one unit per started step', () => {
    for (const frames of [1_000, step, step + 1, chunk, 793_800 * 2 + 7]) {
      expect(planSeparation(geometry, frames)).toHaveLength(
        Math.ceil(frames / step),
      );
    }
  });
});

describe('settled and reached frames', () => {
  const units = [0, 3, 6, 9, 7].map((start) => ({ start, length: 5 }));

  it('settles the frames no remaining window can touch', () => {
    expect(settledFrames(units, 0, 12)).toBe(0);
    expect(settledFrames(units, 2, 12)).toBe(6);
    expect(settledFrames(units, 3, 12)).toBe(7);
    expect(settledFrames(units, 5, 12)).toBe(12);
  });

  it('reaches the end of the folded windows within the track', () => {
    expect(reachedFrames(units, 0, 12)).toBe(0);
    expect(reachedFrames(units, 2, 12)).toBe(8);
    expect(reachedFrames(units, 4, 12)).toBe(12);
  });
});
