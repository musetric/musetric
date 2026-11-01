import { describe, expect, it } from 'vitest';
import { createClockStall } from '../clockStall.cross.js';

const limitMs = 500;
const sampleMs = 100;

describe('clock stall', () => {
  it('is not stalled while the context time advances', () => {
    const stall = createClockStall(limitMs, 0, 0);
    for (let step = 1; step <= 10; step += 1) {
      stall.observe(step * 0.1, step * sampleMs);
    }
    expect(stall.isStalled(10 * sampleMs)).toBe(false);
  });

  it('is stalled when the context time stands still past the limit', () => {
    const stall = createClockStall(limitMs, 0, 0);
    stall.observe(0.1, sampleMs);
    for (let step = 2; step <= 8; step += 1) {
      stall.observe(0.1, step * sampleMs);
    }
    expect(stall.isStalled(8 * sampleMs)).toBe(true);
  });

  it('is not stalled again right after a restart', () => {
    const stall = createClockStall(limitMs, 0, 0);
    expect(stall.isStalled(limitMs)).toBe(true);
    stall.restart(limitMs);
    expect(stall.isStalled(limitMs + sampleMs)).toBe(false);
  });
});
