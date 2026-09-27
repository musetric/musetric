import { describe, expect, it } from 'vitest';
import { type PitchFrame } from './pitchAccuracy.es.js';
import { comparePitchLine } from './pitchLine.es.js';

const hopSeconds = 0.005;
const frameCount = 400;
const voiceHz = 220;

const referenceOf = (voiced: (index: number) => boolean): PitchFrame[] =>
  Array.from({ length: frameCount }, (_, index) => ({
    time: index * hopSeconds,
    f0: voiced(index) ? voiceHz : 0,
    trusted: voiced(index),
  }));

const oursOf = (hz: (index: number) => number): PitchFrame[] =>
  Array.from({ length: frameCount }, (_, index) => ({
    time: index * hopSeconds,
    f0: hz(index),
    trusted: true,
  }));

const cents = (value: number): number => voiceHz * 2 ** (value / 1200);

const compare = (reference: PitchFrame[], ours: PitchFrame[]) =>
  comparePitchLine(reference, ours, {
    fromSeconds: 0,
    toSeconds: Infinity,
    worstCount: 1,
  }).overview;

describe('pitch line quality', () => {
  const singing = referenceOf(() => true);

  it('keeps a line on the voice clean', () => {
    const line = compare(singing, singing);
    expect(line.cleanShare).toBe(1);
    expect(line.stepsPerMinute + line.holesPerMinute).toBe(0);
  });

  it('counts a spike as two steps, wrong frames and jerky neighbours', () => {
    const line = compare(
      singing,
      oursOf((index) => (index >= 200 && index < 204 ? cents(100) : voiceHz)),
    );
    expect(line.stepsPerMinute * line.singingMinutes).toBeCloseTo(2);
    expect(line.wrongShare).toBeCloseTo(4 / frameCount);
    expect(line.jerkyShare).toBeGreaterThan(0);
  });

  it('counts missing singing as a hole', () => {
    const line = compare(
      singing,
      oursOf((index) => (index >= 100 && index < 112 ? 0 : voiceHz)),
    );
    expect(line.holesPerMinute * line.singingMinutes).toBeCloseTo(1);
    expect(line.missingShare).toBeCloseTo(12 / frameCount);
  });

  it('counts a line away from the voice as an island', () => {
    const line = compare(
      referenceOf((index) => index < 100),
      oursOf((index) =>
        index < 100 || (index >= 250 && index < 270) ? voiceHz : 0,
      ),
    );
    expect(line.islandsPerMinute * line.singingMinutes).toBeCloseTo(1);
    expect(line.tailsPerMinute).toBe(0);
  });

  it('marks a wobbling line as rattling', () => {
    const line = compare(
      singing,
      oursOf((index) => cents(index % 2 === 0 ? 15 : -15)),
    );
    expect(line.rattlingShare).toBeGreaterThan(0.9);
    expect(line.rattleCents).toBeGreaterThan(10);
  });
});
