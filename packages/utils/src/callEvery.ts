type AsyncFunction<Args extends unknown[], Result> = (
  ...args: Args
) => Promise<Result>;

type QueueItem<Args extends unknown[], Result> = {
  args: Args;
  reject: (reason?: unknown) => void;
  resolve: (value: Result | PromiseLike<Result>) => void;
};

const createCallEveryInternal = <Args extends unknown[], Result>(
  asyncFunction: AsyncFunction<Args, Result>,
): AsyncFunction<Args, Result> => {
  const queue: Array<QueueItem<Args, Result>> = [];
  let currentItem: QueueItem<Args, Result> | undefined = undefined;

  const runCurrent = () => {
    if (!currentItem) return;

    void asyncFunction(...currentItem.args)
      .then(currentItem.resolve, currentItem.reject)
      .finally(() => {
        currentItem = queue.shift();
        if (currentItem) {
          runCurrent();
        }
      });
  };

  return async (...args: Args): Promise<Result> => {
    return new Promise<Result>((resolve, reject) => {
      const item: QueueItem<Args, Result> = { args, reject, resolve };
      if (!currentItem) {
        currentItem = item;
        runCurrent();
        return;
      }
      queue.push(item);
    });
  };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CreateCallEvery = <Call extends AsyncFunction<any[], any>>(
  asyncFunction: Call,
) => Call;
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
export const createCallEvery = createCallEveryInternal as CreateCallEvery;
