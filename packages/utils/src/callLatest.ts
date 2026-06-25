import {
  type ControlledPromise,
  createControlledPromise,
} from './controlledPromise.js';

type AsyncFunction<Args extends unknown[], Result> = (
  ...args: Args
) => Promise<Result>;

const createCallLatestInternal = <Args extends unknown[], Result>(
  asyncFunction: AsyncFunction<Args, Result>,
): AsyncFunction<Args, Result> => {
  let currentPromise: ControlledPromise<Result> | undefined = undefined;
  let nextPromise: ControlledPromise<Result> | undefined = undefined;
  let call = () => {
    /** Nothing */
  };

  const getPromise = () => {
    if (!currentPromise) {
      currentPromise = createControlledPromise<Result>();
      return [currentPromise, true] as const;
    }
    if (!nextPromise) {
      nextPromise = createControlledPromise<Result>();
    }
    return [nextPromise, false] as const;
  };

  return async (...args: Args): Promise<Result> => {
    const [promise, isCallRightNow] = getPromise();
    call = () => {
      void asyncFunction(...args)
        .then(promise.resolve)
        .finally(() => {
          currentPromise = nextPromise;
          nextPromise = undefined;
          if (currentPromise) {
            call();
          }
        });
    };
    if (isCallRightNow) {
      call();
    }
    return promise.promise;
  };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CreateCallLatest = <Call extends AsyncFunction<any[], any>>(
  asyncFunction: Call,
) => Call;
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
export const createCallLatest = createCallLatestInternal as CreateCallLatest;
