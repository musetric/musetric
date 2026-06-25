export type PromiseResolve<T> = (value: T | PromiseLike<T>) => void;
export type ControlledPromise<T> = {
  promise: Promise<T>;
  resolve: PromiseResolve<T>;
};

export const createControlledPromise = <T>(): ControlledPromise<T> => {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  let resolve: PromiseResolve<T> = undefined!;

  const promise = new Promise<T>((targetResolve) => {
    resolve = targetResolve;
  });

  return { promise, resolve };
};
