export type AnimationFrameLoop = {
  start: () => void;
  stop: () => void;
  restart: () => void;
};

export const createAnimationFrameLoop = (
  run: () => boolean | void,
): AnimationFrameLoop => {
  let handle: number | undefined = undefined;

  const tick = () => {
    handle = undefined;
    if (run() === false) {
      return;
    }

    handle = requestAnimationFrame(tick);
  };

  const ref: AnimationFrameLoop = {
    start: () => {
      if (handle !== undefined) {
        return;
      }

      handle = requestAnimationFrame(tick);
    },
    stop: () => {
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
