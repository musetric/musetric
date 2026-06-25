export type Scheduler = {
  start: () => void;
  stop: () => void;
};

export const createScheduler = (
  run: () => Promise<void>,
  timeout: number,
): Scheduler => {
  let intervalId: ReturnType<typeof setInterval> | undefined = undefined;

  const ref: Scheduler = {
    start: () => {
      if (intervalId) {
        return;
      }

      intervalId = setInterval(() => {
        void run();
      }, timeout);
    },
    stop: () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = undefined;
      }
    },
  };

  return ref;
};
