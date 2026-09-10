import { describe, expect, it } from 'vitest';
import { gpuCooldownMs } from '../gpuCooldown.js';

describe('gpuCooldownMs', () => {
  it('does not pause a device that reports no thermal pressure', () => {
    expect(gpuCooldownMs(0)).toBe(0);
    expect(gpuCooldownMs(1)).toBe(0);
  });

  it('pauses one second once the device throttles', () => {
    expect(gpuCooldownMs(2)).toBe(1000);
    expect(gpuCooldownMs(3)).toBe(1000);
    expect(gpuCooldownMs(4)).toBe(1000);
  });
});
