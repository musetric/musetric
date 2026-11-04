import { describe, expect, it } from 'vitest';
import { createPanTracker, type PanTrackerUpdate } from '../panTracker.js';

type Path = readonly (readonly [number, number])[];

const replay = (path: Path): (PanTrackerUpdate | undefined)[] => {
  const tracker = createPanTracker({ createVelocityTracker: undefined });
  const pointer = { id: 1, type: 'touch', x: 100, y: 100 } as const;
  tracker.start(pointer);
  return path.map((offset) =>
    tracker.update({
      ...pointer,
      x: pointer.x + offset[0],
      y: pointer.y + offset[1],
    }),
  );
};

const lockedAxis = (path: Path) =>
  replay(path).find((update) => update !== undefined)?.axis;

describe('panTracker', () => {
  it('takes a sideways drag that starts with a drift up as x', () => {
    const drift = [
      [1, 3],
      [3, 6],
      [6, 7],
      [10, 8],
    ] as const;
    expect(lockedAxis(drift)).toBe('x');
  });

  it('locks a sideways move at 8 pixels', () => {
    expect(lockedAxis([[7, 0]])).toBeUndefined();
    expect(lockedAxis([[8, 0]])).toBe('x');
    expect(lockedAxis([[-8, 0]])).toBe('x');
  });

  it('locks a vertical move at 16 pixels', () => {
    expect(lockedAxis([[0, 15]])).toBeUndefined();
    expect(lockedAxis([[0, 16]])).toBe('y');
    expect(lockedAxis([[0, -16]])).toBe('y');
  });

  it('waits for 24 pixels when the vertical does not dominate', () => {
    expect(lockedAxis([[7, 13]])).toBeUndefined();
    expect(lockedAxis([[7, 16]])).toBe('y');
    expect(lockedAxis([[12, 19]])).toBeUndefined();
    expect(lockedAxis([[13, 21]])).toBe('y');
  });

  it('gives an even diagonal to x', () => {
    expect(lockedAxis([[8, 8]])).toBe('x');
  });

  it('starts from the lock point without a jump', () => {
    const [before, lock, next] = replay([
      [4, 0],
      [20, 0],
      [25, 1],
    ]);
    expect(before).toBeUndefined();
    expect(lock).toMatchObject({ justLockedAxis: true, axis: 'x', delta: 0 });
    expect(next).toMatchObject({ justLockedAxis: false, axis: 'x', delta: 5 });
  });

  it('keeps the first axis to the end of the drag', () => {
    const updates = replay([
      [0, 20],
      [40, 20],
    ]);
    expect(updates[1]).toMatchObject({ axis: 'y', delta: 0 });
  });

  it('keeps the point where the finger came down', () => {
    expect(replay([[8, 1]])[0]).toMatchObject({
      startClientX: 100,
      startClientY: 100,
    });
  });
});
