export type Unmount = () => void;

type MountFunction<Args extends unknown[]> = (...args: Args) => Unmount;

export type ArgumentsEqual<Args extends unknown[]> = (
  left: Args,
  right: Args,
) => boolean;

export type CreateLazyMountOptions<Args extends unknown[]> = {
  mountDelayMs?: number;
  argumentsEqual?: ArgumentsEqual<Args>;
};

type Active<Args extends unknown[]> = {
  args: Args;
  unmount: Unmount;
};

type Pending<Args extends unknown[]> = {
  args: Args;
  timerId: ReturnType<typeof setTimeout>;
};

const defaultArgumentsEqual = <Args extends unknown[]>(
  left: Args,
  right: Args,
) =>
  left.length === right.length &&
  left.every((value, index) => Object.is(value, right[index]));

const createLazyMountInternal = <Args extends unknown[]>(
  mount: MountFunction<Args>,
  options: CreateLazyMountOptions<Args> = {},
): MountFunction<Args> => {
  const { mountDelayMs = 0, argumentsEqual = defaultArgumentsEqual } = options;

  let active: Active<Args> | undefined = undefined;
  let pending: Pending<Args> | undefined = undefined;

  const clearActive = () => {
    if (active === undefined) {
      return;
    }
    active.unmount();
    active = undefined;
  };

  const clearPending = () => {
    if (pending === undefined) {
      return;
    }
    clearTimeout(pending.timerId);
    pending = undefined;
  };

  return (...args: Args): Unmount => {
    if (active !== undefined && argumentsEqual(active.args, args)) {
      return clearActive;
    }

    clearPending();

    const ticket: Pending<Args> = {
      args,
      timerId: setTimeout(() => {
        if (pending !== ticket) {
          return;
        }
        pending = undefined;
        clearActive();
        active = { args, unmount: mount(...args) };
      }, mountDelayMs),
    };
    pending = ticket;

    return () => {
      if (pending === ticket) {
        clearPending();
        return;
      }
      if (active !== undefined && active.args === args) {
        clearActive();
      }
    };
  };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CreateLazyMount = <Mount extends MountFunction<any[]>>(
  mount: Mount,
  options?: CreateLazyMountOptions<Parameters<Mount>>,
) => Mount;
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
export const createLazyMount = createLazyMountInternal as CreateLazyMount;
