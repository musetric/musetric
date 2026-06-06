import { describe, expect, it } from 'vitest';
import { createCallEvery } from '../../callEvery.js';
import { createControlledPromise } from '../../controlledPromise.js';
import { createPromiseController, getExpectedResults } from './common.js';
import { callEveryFixtures } from './fixture.js';

const waitForQueueSwitch = async () => Promise.resolve();

describe('callEvery', () => {
  callEveryFixtures.forEach((fixture) => {
    it(fixture.name, async () => {
      const { asyncFunction, resolve } = createPromiseController(
        fixture.resolveIndices,
      );
      const callEvery = createCallEvery(asyncFunction);
      const promises: Promise<number>[] = [];

      for (let callIndex = 0; callIndex < fixture.callCount; callIndex++) {
        const promise = callEvery(callIndex);
        promises.push(promise);
        await resolve(callIndex);
      }

      const results = await Promise.all(promises);
      const expectedResults = getExpectedResults(fixture.callCount);
      expect(results).toEqual(expectedResults);
    });
  });

  it('Runs calls one at a time in invocation order', async () => {
    const started: number[] = [];
    const finished: number[] = [];
    const controlledPromises = [
      createControlledPromise<void>(),
      createControlledPromise<void>(),
      createControlledPromise<void>(),
    ];
    let activeCount = 0;
    let maxActiveCount = 0;

    const callEvery = createCallEvery(async (value: number) => {
      started.push(value);
      activeCount++;
      maxActiveCount = Math.max(maxActiveCount, activeCount);
      await controlledPromises[value].promise;
      activeCount--;
      finished.push(value);
      return value;
    });

    const promises = [callEvery(0), callEvery(1), callEvery(2)];

    expect(started).toEqual([0]);

    controlledPromises[0].resolve();
    await promises[0];
    await waitForQueueSwitch();
    expect(started).toEqual([0, 1]);
    expect(finished).toEqual([0]);

    controlledPromises[1].resolve();
    await promises[1];
    await waitForQueueSwitch();
    expect(started).toEqual([0, 1, 2]);
    expect(finished).toEqual([0, 1]);

    controlledPromises[2].resolve();
    const results = await Promise.all(promises);

    expect(results).toEqual([0, 1, 2]);
    expect(finished).toEqual([0, 1, 2]);
    expect(maxActiveCount).toBe(1);
  });
});
