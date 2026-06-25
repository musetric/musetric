import { describe, expect, it } from 'vitest';
import { createControlledPromise } from '../controlledPromise.js';

const marker = 'marker';

describe('controlledPromise', () => {
  it('should resolve the promise when resolved', async () => {
    const { promise, resolve } = createControlledPromise<number>();
    resolve(42);
    const result = await promise;
    expect(result).toBe(42);
  });

  it('should win the race with resolved promise', async () => {
    const { promise, resolve } = createControlledPromise<number>();
    resolve(99);
    const result = await Promise.race([promise, Promise.resolve(marker)]);
    expect(result).toBe(99);
  });

  it('should win the race with marker if not resolved', async () => {
    const { promise } = createControlledPromise<number>();
    const result = await Promise.race([promise, Promise.resolve(marker)]);
    expect(result).toBe(marker);
  });
});
