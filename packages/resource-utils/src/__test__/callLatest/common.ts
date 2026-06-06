import { createControlledPromise } from '../../controlledPromise.js';

export const getExpectedResults = (
  callCount: number,
  resolveIndices: number[],
): number[] => {
  const resolvesAt: number[] = Array.from({ length: callCount }, () => 0);
  for (const idx of resolveIndices) {
    if (idx >= 0 && idx < callCount) resolvesAt[idx]++;
  }

  const expected: number[] = Array(callCount);

  let activeWaveIndices: number[] = [];
  let pendingWaveIndices: number[] = [];

  const closeActiveWave = () => {
    if (activeWaveIndices.length === 0) return;
    const resultValue = activeWaveIndices[activeWaveIndices.length - 1];
    for (const i of activeWaveIndices) expected[i] = resultValue;
    activeWaveIndices = pendingWaveIndices;
    pendingWaveIndices = [];
  };

  for (let callIndex = 0; callIndex < callCount; callIndex++) {
    if (activeWaveIndices.length === 0) {
      activeWaveIndices = [callIndex];
    } else {
      pendingWaveIndices.push(callIndex);
    }

    for (let k = 0; k < resolvesAt[callIndex]; k++) {
      closeActiveWave();
    }
  }

  return expected;
};

export const createPromiseController = (resolveIndices: number[]) => {
  type Resolve = () => Promise<void>;
  const resolves: Array<Resolve> = [];
  let resolverIndex = 0;

  const resolveNext = async () => {
    if (resolverIndex === resolves.length) return;

    const resolve = resolves[resolverIndex];
    await resolve();
    resolverIndex++;
  };

  return {
    asyncFunction: async (value: number) => {
      const controlledPromise = createControlledPromise<number>();
      resolves.push(async () => {
        controlledPromise.resolve(value);
        await controlledPromise.promise.finally();
      });
      return controlledPromise.promise;
    },
    resolve: async (callIndex: number) => {
      for (const resolveIndex of resolveIndices) {
        if (callIndex === resolveIndex) {
          await resolveNext();
        }
      }
    },
  };
};
