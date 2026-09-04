import { describe, expect, it } from 'vitest';
import { gpuCooldownMs } from '../gpuCooldown.js';

describe('gpuCooldownMs', () => {
  it('does not pause off Android', () => {
    expect(gpuCooldownMs(false, 3)).toBe(0);
  });

  it('pauses one second on a cool Android device', () => {
    expect(gpuCooldownMs(true, 0)).toBe(1000);
    expect(gpuCooldownMs(true, 1)).toBe(1000);
  });

  it('lengthens the pause as the device heats up', () => {
    expect(gpuCooldownMs(true, 2)).toBe(3000);
    expect(gpuCooldownMs(true, 3)).toBe(10_000);
    expect(gpuCooldownMs(true, 4)).toBe(10_000);
  });
});
