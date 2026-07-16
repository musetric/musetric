import { describe, expect, it } from 'vitest';
import { pickBeatTimes } from '../beatPeaks.js';

const logits = (
  frames: number,
  peaks: Record<number, number>,
): Float32Array => {
  const values = new Float32Array(frames).fill(-5);
  for (const [frame, value] of Object.entries(peaks)) {
    values[Number(frame)] = value;
  }
  return values;
};

describe('pickBeatTimes', () => {
  it('converts peak frames to seconds at 50 fps', () => {
    const beat = logits(200, { 25: 3, 75: 3, 125: 3 });
    const { beats } = pickBeatTimes(beat, logits(200, {}));
    expect(beats).toEqual([0.5, 1.5, 2.5]);
  });

  it('drops peaks that are not above the threshold', () => {
    const beat = logits(100, { 10: 2, 50: 0, 90: -1 });
    const { beats } = pickBeatTimes(beat, logits(100, {}));
    expect(beats).toEqual([0.2]);
  });

  it('suppresses a lower peak within the local maximum radius', () => {
    const beat = logits(100, { 20: 3, 22: 1 });
    const { beats } = pickBeatTimes(beat, logits(100, {}));
    expect(beats).toEqual([0.4]);
  });

  it('averages adjacent peaks of equal height into one beat', () => {
    const beat = logits(100, { 40: 3, 41: 3 });
    const { beats } = pickBeatTimes(beat, logits(100, {}));
    expect(beats).toEqual([0.81]);
  });

  it('snaps downbeats onto the nearest beat and dedupes collisions', () => {
    const beat = logits(300, { 50: 4, 100: 4, 150: 4 });
    const downbeat = logits(300, { 48: 4, 148: 4 });
    const { beats, downbeats } = pickBeatTimes(beat, downbeat);
    expect(beats).toEqual([1, 2, 3]);
    expect(downbeats).toEqual([1, 3]);
  });

  it('returns nothing for silence', () => {
    const { beats, downbeats } = pickBeatTimes(logits(50, {}), logits(50, {}));
    expect(beats).toEqual([]);
    expect(downbeats).toEqual([]);
  });
});
