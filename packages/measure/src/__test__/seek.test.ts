import { describe, expect, it } from 'vitest';
import { analyzeSeek } from './analysis/seek.js';
import { type SeekRun } from './runs.js';

const createRun = (
  buffering: SeekRun['buffering'],
  requests: SeekRun['requests'],
): SeekRun => ({
  sampleRate: 48000,
  frameCount: 10_000_000,
  seeks: [
    [1000, 2_000_000],
    [3500, 5_000_000],
    [6000, 8_000_000],
  ],
  decoys: [],
  buffering,
  endedAt: 8500,
  requests,
});

describe('analyzeSeek', () => {
  it('times each seek to the end of the hold that follows it', () => {
    const run = createRun(
      [
        [0, 0],
        [1004, 1],
        [1040, 0],
        [3503, 1],
        [3590, 0],
        [6002, 0],
      ],
      [],
    );

    const result = analyzeSeek(run);

    expect(result.toSoundMs).toEqual([40, 90]);
    expect(result.heldMs).toEqual([36, 87]);
    expect(result.unheld).toBe(1);
    expect(result.silent).toBe(0);
  });

  it('holds a seek from its start when the sound is still waiting', () => {
    const run = createRun(
      [
        [0, 0],
        [900, 1],
        [1060, 0],
      ],
      [],
    );

    const result = analyzeSeek(run);

    expect(result.toSoundMs).toEqual([60]);
    expect(result.heldMs).toEqual([60]);
  });

  it('counts a seek still waiting at the next one as silent', () => {
    const run = createRun(
      [
        [0, 0],
        [1004, 1],
        [3600, 0],
      ],
      [],
    );

    const result = analyzeSeek(run);

    expect(result.toSoundMs).toEqual([100]);
    expect(result.silent).toBe(1);
    expect(result.unheld).toBe(1);
  });

  it('counts the range requests a seek waited for and those it aborted', () => {
    const run = createRun(
      [
        [0, 0],
        [1004, 1],
        [1040, 0],
      ],
      [
        { stem: 'lead', sentAt: 900, endedAt: 1010, failed: false },
        { stem: 'backing', sentAt: 950, endedAt: 1003, failed: true },
        { stem: 'lead', sentAt: 1002, endedAt: 1030, failed: false },
        { stem: 'instrumental', sentAt: 1002, endedAt: 1060, failed: false },
        { stem: 'lead', sentAt: 1050, failed: false },
      ],
    );

    const result = analyzeSeek(run);

    expect(result.waitedRequests).toEqual([2]);
    expect(result.abortedRequests).toEqual([1, 0, 0]);
    expect(result.leadRequests).toEqual([2, 0, 0]);
    expect(result.requestsPerSecond).toEqual({
      lead: 2 / 7.5,
      backing: 0,
      instrumental: 1 / 7.5,
    });
  });
});
