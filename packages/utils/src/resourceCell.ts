type ResourceController<Arg, Value> = {
  create: (arg: Arg) => Value;
  dispose: (value: Value) => void;
  equals: (currentArg: Arg, nextArg: Arg) => boolean;
};

export type ResourceCell<Arg, Value> = {
  get: (arg: Arg) => Value;
  dispose: () => void;
};

export const createResourceCell = <Arg, Value>(
  controller: ResourceController<Arg, Value>,
): ResourceCell<Arg, Value> => {
  let currentArg: Arg | undefined = undefined;
  let currentValue: Value | undefined = undefined;

  return {
    get: (arg: Arg): Value => {
      if (
        currentArg !== undefined &&
        currentValue !== undefined &&
        controller.equals(currentArg, arg)
      ) {
        return currentValue;
      }

      if (currentValue !== undefined) {
        controller.dispose(currentValue);
      }

      currentArg = undefined;
      currentValue = undefined;

      const nextValue = controller.create(arg);

      currentArg = arg;
      currentValue = nextValue;

      return nextValue;
    },
    dispose: () => {
      if (currentValue !== undefined) {
        controller.dispose(currentValue);
      }
      currentArg = undefined;
      currentValue = undefined;
    },
  };
};
