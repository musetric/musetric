export const waitWithTimeout = async <Value>(
  promise: Promise<Value>,
  timeoutMs: number,
): Promise<Value | undefined> =>
  await Promise.race([
    promise,
    new Promise<undefined>((resolve) => {
      setTimeout(() => {
        resolve(undefined);
      }, timeoutMs);
    }),
  ]);
