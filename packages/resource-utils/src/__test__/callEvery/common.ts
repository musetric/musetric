import { createControlledPromise } from '../../controlledPromise.js';

export const getExpectedResults = (callCount: number): number[] =>
  Array.from({ length: callCount }, (_, index) => index);

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
