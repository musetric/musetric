import { describe, expect, it } from 'vitest';
import { analyzeCursor } from './analysis/cursor.js';
import { type CursorRun } from './runs.js';

const sampleRate = 48000;
const screenMs = 1000 / 60;
const loop = { fromFrame: 480000, toFrame: 576000 };

type Shown = (time: number) => { frame: number; playing: boolean };

const createRun = (
  durationMs: number,
  shown: Shown,
  events: CursorRun['events'],
): CursorRun => {
  const frames: CursorRun['frames'] = [];
  for (let time = 0; time <= durationMs; time += screenMs) {
    const { frame, playing } = shown(time);
    frames.push([time, Math.round(frame), playing ? 1 : 0]);
  }
  return { sampleRate, frameCount: 10_000_000, frames, events, loop };
};

const rolling = (from: number, startMs: number) => (time: number) =>
  from + ((time - startMs) / 1000) * sampleRate;

describe('analyzeCursor', () => {
  it('finds nothing in a steady run that holds on Stop', () => {
    const stopMs = 2500;
    const run = createRun(
      3300,
      (time) =>
        time < stopMs
          ? { frame: rolling(0, 0)(time), playing: true }
          : { frame: rolling(0, 0)(stopMs - screenMs), playing: false },
      [
        [0, 'play', 0],
        [stopMs, 'stop', Math.round(rolling(0, 0)(stopMs - screenMs))],
      ],
    );
    const result = analyzeCursor(run);
    expect(result.run).toEqual({
      stepsBack: 0,
      largestStepBackMs: 0,
      stalls: 0,
      longestStallMs: 0,
    });
    expect(result.stop.jumps.map(Math.round)).toEqual([0]);
    expect(result.stop.largestReversalMs).toBe(0);
    expect(result.screenFrameMs).toBeCloseTo(screenMs, 1);
  });

  it('counts a step back and a stall while playing', () => {
    const run = createRun(
      3000,
      (time) => {
        if (time > 1000 && time < 1300) {
          return { frame: rolling(0, 0)(1000), playing: true };
        }
        const back = time > 2000 ? 0.05 * sampleRate : 0;
        return { frame: rolling(0, 0)(time) - back, playing: true };
      },
      [[0, 'play', 0]],
    );
    const result = analyzeCursor(run);
    expect(result.run.stepsBack).toBe(1);
    expect(result.run.stalls).toBe(1);
    expect(result.run.longestStallMs).toBeGreaterThan(250);
  });

  it('measures the jump and the reversed motion after Stop', () => {
    const stopMs = 1000;
    const atStop = rolling(0, 0)(stopMs);
    const run = createRun(
      1800,
      (time) => {
        if (time <= stopMs) {
          return { frame: rolling(0, 0)(time), playing: true };
        }
        if (time < 1100) {
          return { frame: rolling(0, 0)(time), playing: false };
        }
        return { frame: atStop - 0.02 * sampleRate, playing: false };
      },
      [
        [0, 'play', 0],
        [stopMs, 'stop', Math.round(atStop)],
      ],
    );
    const { stop } = analyzeCursor(run);
    expect(stop.jumps[0]).toBeCloseTo(-20 / screenMs, 0);
    expect(stop.largestReversalMs).toBeGreaterThan(150);
  });

  it('takes the turns of a loop for no steps back and finds the furthest point', () => {
    const length = loop.toFrame - loop.fromFrame;
    const run = createRun(
      7000,
      (time) => {
        const played = (time / 1000) * sampleRate;
        return { frame: loop.fromFrame + (played % (length + 960)), playing: true };
      },
      [
        [0, 'loopStart', loop.fromFrame],
        [7000, 'loopEnd', 0],
      ],
    );
    const { loop: result } = analyzeCursor(run);
    expect(result.turns).toBe(3);
    expect(result.stepsBack).toBe(0);
    expect(result.overshootMs).toBeGreaterThan(15);
  });

  it('tells a cursor standing after a seek within the round trip of Play', () => {
    const target = 240000;
    const run = createRun(
      1500,
      (time) => ({ frame: time < 50 ? 0 : target, playing: true }),
      [
        [40, 'playSeek', target],
        [1500, 'stop', target],
      ],
    );
    const { playSeek } = analyzeCursor(run);
    expect(playSeek).toEqual(
      expect.objectContaining({ count: 1, standing: 1 }),
    );
  });

  it('times a seek until the cursor shows its target', () => {
    const target = 2_000_000;
    const run = createRun(
      1500,
      (time) =>
        time < 200
          ? { frame: rolling(0, 0)(time), playing: true }
          : { frame: rolling(target, 200)(time), playing: true },
      [
        [0, 'play', 0],
        [150, 'seek', target],
      ],
    );
    const { seek } = analyzeCursor(run);
    expect(seek.unsettled).toBe(0);
    expect(seek.settleMs[0]).toBeGreaterThan(40);
    expect(seek.settleMs[0]).toBeLessThan(70);
  });
});
