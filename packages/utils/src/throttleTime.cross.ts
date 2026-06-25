type SyncFunction<Args extends unknown[]> = (...args: Args) => void;

const createThrottleTimeInternal = <Args extends unknown[]>(
  fn: SyncFunction<Args>,
  delayMs: number,
): SyncFunction<Args> => {
  let lastCallTime = -Infinity;
  let pendingArgs: Args | undefined = undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined = undefined;

  const fire = (args: Args) => {
    lastCallTime = Date.now();
    pendingArgs = undefined;
    fn(...args);
  };

  return (...args: Args) => {
    const now = Date.now();
    const elapsed = now - lastCallTime;

    if (elapsed >= delayMs) {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
      fire(args);
      return;
    }

    pendingArgs = args;
    if (timeoutId === undefined) {
      timeoutId = setTimeout(() => {
        timeoutId = undefined;
        if (pendingArgs !== undefined) {
          fire(pendingArgs);
        }
      }, delayMs - elapsed);
    }
  };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CreateThrottleTime = <Call extends SyncFunction<any[]>>(
  fn: Call,
  delayMs: number,
) => Call;
export const createThrottleTime =
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  createThrottleTimeInternal as CreateThrottleTime;
