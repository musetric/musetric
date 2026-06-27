export type AnimationFrameLoop = {
  start: () => void;
  stop: () => void;
  restart: () => void;
};

export const createAnimationFrameLoop = (
  run: () => Promise<boolean | void> | boolean | void,
): AnimationFrameLoop => {
  let handle: number | undefined = undefined;
  let started = false;

  const tick = async () => {
    handle = undefined;
    if (!started) {
      return;
    }

    const result = await run();
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!started || result === false) {
      started = false;
      return;
    }

    handle = requestAnimationFrame(tick);
  };

  const ref: AnimationFrameLoop = {
    start: () => {
      if (started) {
        return;
      }

      started = true;
      handle = requestAnimationFrame(tick);
    },
    stop: () => {
      started = false;
      if (handle === undefined) {
        return;
      }

      cancelAnimationFrame(handle);
      handle = undefined;
    },
    restart: () => {
      ref.stop();
      ref.start();
    },
  };

  return ref;
};
