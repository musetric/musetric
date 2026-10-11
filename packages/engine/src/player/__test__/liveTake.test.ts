import { describe, expect, it } from 'vitest';
import { continuesRun, createLiveRun } from '../liveTake.cross.js';

const chunk = (startFrame: number, offset: number) => ({
  startFrame,
  offset,
  samples: new Float32Array(4),
});

describe('live take', () => {
  it('continues a run only with a later chunk from the same start', () => {
    const run = createLiveRun(chunk(10, 0), 1);
    expect(continuesRun(run, chunk(10, 256))).toBe(true);
    expect(continuesRun(run, chunk(12, 256))).toBe(false);
    expect(continuesRun(run, chunk(10, 0))).toBe(false);
    expect(continuesRun(undefined, chunk(10, 256))).toBe(false);
  });

  it('places a run joined late where its first chunk was sung', () => {
    expect(createLiveRun(chunk(10, 8), 0.5).piece.songStartFrame).toBe(14);
  });
});
