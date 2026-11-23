import { describe, expect, it } from 'vitest';
import { createTakeWindow, layTakePiece, takeFrameOnSong } from './take.js';

const ramp = (length: number, from: number) =>
  Float32Array.from({ length }, (_, index) => from + index);

describe('take window', () => {
  it('lays a piece sung at 0.75x at its frames as recorded', () => {
    const take = createTakeWindow(1000, 1300, 0.75);
    layTakePiece(take, {
      songStartFrame: 1150,
      tempo: 0.75,
      samples: ramp(100, 1),
    });
    expect(take.samples).toHaveLength(400);
    expect(take.samples[199]).toBe(0);
    expect(take.samples[200]).toBe(1);
    expect(take.samples[299]).toBe(100);
    expect(take.samples[300]).toBe(0);
    expect(takeFrameOnSong(take, 200)).toBe(1150);
    expect(takeFrameOnSong(take, 299)).toBe(1150 + 99 * 0.75);
  });

  it('cuts a piece at the edges of the window', () => {
    const take = createTakeWindow(1000, 1060, 2);
    layTakePiece(take, { songStartFrame: 980, tempo: 2, samples: ramp(50, 1) });
    expect(take.samples).toHaveLength(30);
    expect(take.samples[0]).toBe(11);
    expect(take.samples[29]).toBe(40);
  });

  it('lays a later piece over an earlier one', () => {
    const take = createTakeWindow(0, 10, 1);
    layTakePiece(take, { songStartFrame: 0, tempo: 1, samples: ramp(10, 1) });
    layTakePiece(take, { songStartFrame: 4, tempo: 1, samples: ramp(2, 100) });
    expect([...take.samples]).toEqual([1, 2, 3, 4, 100, 101, 7, 8, 9, 10]);
  });

  it('refuses a piece sung at another tempo than the take', () => {
    const take = createTakeWindow(0, 100, 0.75);
    expect(() => {
      layTakePiece(take, { songStartFrame: 0, tempo: 1, samples: ramp(4, 1) });
    }).toThrow('tempo 1, not 0.75');
  });
});
