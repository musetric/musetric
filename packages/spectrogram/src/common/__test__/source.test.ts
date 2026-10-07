import { describe, expect, it } from 'vitest';
import { createMappedSource, createPlainSource } from '../source.js';

const ramp = (length: number, from: number): Float32Array =>
  Float32Array.from({ length }, (_, index) => from + index);

const readAll = (
  source: ReturnType<typeof createMappedSource>,
): Float32Array => {
  const target = new Float32Array(source.length);
  source.read(target, 0, 0, source.length);
  return target;
};

describe('spectrogram source', () => {
  it('reads a plain array as it is', () => {
    const source = createPlainSource(ramp(4, 1));
    const target = new Float32Array(6);
    source.read(target, 0, -1, 6);
    expect(Array.from(target)).toEqual([0, 1, 2, 3, 4, 0]);
    expect(source.position(2.5)).toBe(2.5);
  });

  it('lays a slow take out at its raw length between gaps', () => {
    const raw = ramp(8, 100);
    const source = createMappedSource(
      [
        {
          songStartFrame: 2,
          songEndFrame: 6,
          rawStartFrame: 0,
          tempo: 0.5,
          getSamples: () => raw,
        },
      ],
      10,
    );
    expect(source).toHaveLength(2 + 8 + 4);
    expect(source.stretch).toBe(2);
    expect(source.position(1)).toBe(1);
    expect(source.position(2)).toBe(2);
    expect(source.position(4)).toBe(6);
    expect(source.position(6)).toBe(10);
    expect(source.position(8)).toBe(12);
    expect(Array.from(readAll(source))).toEqual([
      0, 0, 100, 101, 102, 103, 104, 105, 106, 107, 0, 0, 0, 0,
    ]);
  });

  it('starts a cut piece at its raw offset and keeps neighbours apart', () => {
    const slow = ramp(8, 100);
    const fast = ramp(4, 200);
    const source = createMappedSource(
      [
        {
          songStartFrame: 0,
          songEndFrame: 2,
          rawStartFrame: 4,
          tempo: 0.5,
          getSamples: () => slow,
        },
        {
          songStartFrame: 2,
          songEndFrame: 6,
          rawStartFrame: 0,
          tempo: 2,
          getSamples: () => fast,
        },
      ],
      6,
    );
    expect(source.reach).toBe(2);
    expect(Array.from(readAll(source))).toEqual([104, 105, 106, 107, 200, 201]);
    expect(source.position(3)).toBe(4.5);
  });
});
