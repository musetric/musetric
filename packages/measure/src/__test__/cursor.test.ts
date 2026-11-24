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
  return {
    sampleRate,
    frameCount: 10_000_000,
    frames,
    events,
    storeChanges: [],
    buffering: [],
    drawn: [],
    writes: [],
    loop,
  };
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
    expect(stop.distancesMs[0]).toBeCloseTo(-20, 0);
    expect(stop.jumps[0]).toBeGreaterThan(5);
    expect(stop.largestReversalMs).toBeGreaterThan(150);
  });

  it('takes a glide after Stop for a distance, not a jump', () => {
    const stopMs = 1000;
    const end = rolling(0, 0)(stopMs + 100);
    const run = createRun(
      1800,
      (time) =>
        time <= stopMs
          ? { frame: rolling(0, 0)(time), playing: true }
          : { frame: Math.min(end, rolling(0, 0)(time)), playing: false },
      [
        [0, 'play', 0],
        [stopMs, 'stop', Math.round(rolling(0, 0)(stopMs))],
      ],
    );
    const { stop } = analyzeCursor(run);
    expect(stop.jumps[0]).toBeLessThan(1.5);
    expect(stop.distancesMs[0]).toBeCloseTo(100, -1);
    expect(stop.largestReversalMs).toBe(0);
  });

  it('leaves a seek after Stop out of the jump on Stop', () => {
    const stopMs = 1000;
    const atStop = rolling(0, 0)(stopMs);
    const run = createRun(
      2200,
      (time) => {
        if (time <= stopMs) {
          return { frame: rolling(0, 0)(time), playing: true };
        }
        return { frame: time < 1800 ? atStop : 0, playing: false };
      },
      [
        [0, 'play', 0],
        [stopMs, 'stop', Math.round(atStop)],
      ],
    );
    const { stop } = analyzeCursor(run);
    expect(stop.jumps.map(Math.round)).toEqual([0]);
    expect(stop.largestReversalMs).toBe(0);
  });

  it('takes the turns of a loop for no steps back and finds the furthest point', () => {
    const length = loop.toFrame - loop.fromFrame;
    const run = createRun(
      7000,
      (time) => {
        const played = (time / 1000) * sampleRate;
        return {
          frame: loop.fromFrame + (played % (length + 960)),
          playing: true,
        };
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

  it('counts the changes of the store a second while the song plays', () => {
    const stopMs = 2400;
    const run = {
      ...createRun(stopMs, (time) => ({ frame: time, playing: true }), [
        [0, 'play', 0],
        [stopMs, 'stop', stopMs],
      ]),
      storeChanges: [10, 300, 900, 1500, 2100, 2500],
    };
    const { store } = analyzeCursor(run);
    expect(store.changesPerSecond).toEqual([1.5]);
  });

  it('times each wait for missing pages', () => {
    const run = {
      ...createRun(1000, (time) => ({ frame: time, playing: true }), [
        [0, 'play', 0],
      ]),
      buffering: [
        [100, 1],
        [131, 0],
        [400, 1],
        [400, 1],
        [452, 0],
        [600, 0],
      ] satisfies CursorRun['buffering'],
    };
    const { buffering } = analyzeCursor(run);
    expect(buffering.heldMs).toEqual([31, 52]);
  });
  it('tells how far the cursor runs ahead of the sound after Play', () => {
    const stopMs = 2500;
    const heardMs = 100;
    const heard = (time: number) =>
      rolling(0, heardMs)(Math.max(heardMs, time));
    const waiting = createRun(
      stopMs,
      (time) => ({ frame: heard(time), playing: true }),
      [
        [0, 'play', 0],
        [stopMs, 'stop', heard(stopMs)],
      ],
    );
    const ahead = createRun(
      stopMs,
      (time) => ({
        frame: heard(time) + Math.max(0, 0.09 * sampleRate * (1 - time / 1000)),
        playing: true,
      }),
      [
        [0, 'play', 0],
        [stopMs, 'stop', heard(stopMs)],
      ],
    );
    expect(analyzeCursor(waiting).play.leadMs[0]).toBeLessThan(1);
    expect(analyzeCursor(ahead).play.leadMs[0]).toBeGreaterThan(80);
  });

  it('tells a spectrogram that stays behind the finger in a drag', () => {
    const target = 100_000;
    const run = {
      ...createRun(
        1000,
        (time) => ({ frame: time < 200 ? 0 : target, playing: true }),
        [
          [0, 'play', 0],
          [100, 'dragStart', 0],
          [900, 'dragEnd', target],
        ],
      ),
      drawn: [
        [50, 0, 1],
        [500, 0, 1],
        [880, 0, 1],
      ] satisfies CursorRun['drawn'],
    };
    const { drag, spectrogram } = analyzeCursor(run);
    expect(drag.behindMs).toEqual([0]);
    expect(spectrogram.count).toBe(3);
    expect(spectrogram.behindMs[0]).toBeCloseTo(
      (target / sampleRate) * 1000,
      3,
    );
  });
  it('tells how far the spectrogram is from the ruler while playing', () => {
    const line = rolling(0, 0);
    const base = createRun(
      3000,
      (time) => ({ frame: line(time), playing: true }),
      [[0, 'play', 0]],
    );
    const writes: CursorRun['writes'] = base.frames.map((entry) => [
      entry[0],
      entry[1],
    ]);
    const drawnAt = (lagMs: number): CursorRun['drawn'] =>
      Array.from({ length: 60 }, (_, index) => {
        const time = 1000 + index * 25;
        return [time, Math.round(line(time - lagMs)), 1];
      });
    const together = analyzeCursor({ ...base, writes, drawn: drawnAt(0) });
    const behind = analyzeCursor({ ...base, writes, drawn: drawnAt(screenMs) });
    expect(together.apart.count).toBe(60);
    expect(together.apart.largestMs).toBeLessThan(0.1);
    expect(behind.apart.medianMs).toBeCloseTo(screenMs, 1);
  });
});
