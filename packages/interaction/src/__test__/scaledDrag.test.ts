import { describe, expect, it } from 'vitest';
import { createScaledDrag } from '../scaledDrag.js';

const min = 8;
const max = 124;

const drag = (startPosition: number, startValue: number) =>
  createScaledDrag({ startPosition, startValue, maxValue: 100, min, max });

describe('scaledDrag', () => {
  it('does not move the value at the start', () => {
    expect(drag(70, 35)(70)).toBe(35);
  });

  it('reaches zero at the left end from any start', () => {
    for (const start of [12, 30, 66, 120]) {
      expect(drag(start, 100)(min)).toBe(0);
    }
  });

  it('reaches the maximum at the right end from any start', () => {
    for (const start of [12, 30, 66, 80]) {
      expect(drag(start, 0)(max)).toBe(100);
    }
  });

  it('stays inside the range past the ends', () => {
    const scaled = drag(66, 50);
    expect(scaled(0)).toBe(0);
    expect(scaled(300)).toBe(100);
  });

  it('scales each side by the way left on that side', () => {
    const scaled = drag(58, 50);
    expect(scaled(33)).toBe(25);
    expect(scaled(91)).toBe(75);
  });

  it('keeps some way to the maximum for a finger at the right end', () => {
    const scaled = drag(120, 50);
    expect(scaled(140)).toBe(75);
    expect(scaled(160)).toBe(100);
  });

  it('keeps some way to zero when the end is too close and the screen allows', () => {
    const scaled = createScaledDrag({
      startPosition: 310,
      startValue: 100,
      maxValue: 100,
      min: 300,
      max: 416,
    });
    expect(scaled(290)).toBe(50);
    expect(scaled(270)).toBe(0);
  });

  it('leaves the value alone when a finger has no way left', () => {
    const scaled = drag(4, 60);
    expect(scaled(2)).toBe(60);
  });
});
