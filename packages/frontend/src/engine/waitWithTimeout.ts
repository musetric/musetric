export const waitWithTimeout = async (
  promise: Promise<void>,
  timeoutMs: number,
): Promise<boolean> =>
  await Promise.race([
    promise.then(() => true),
    new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    }).then(() => false),
  ]);
