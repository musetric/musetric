type CreateFunction<Args extends unknown[], Instance> = (
  ...args: Args
) => Promise<Instance>;

export type SingletonManager<Args extends unknown[], Instance> = {
  instance: Instance | undefined;
  create: (...args: Args) => Promise<Instance>;
  destroy: () => Promise<void>;
};

export const createSingletonManager = <Args extends unknown[], Instance>(
  create: CreateFunction<Args, Instance>,
  destroy: (instance: Instance) => void | Promise<void>,
): SingletonManager<Args, Instance> => {
  let instancePromise: Promise<Instance> | undefined = undefined;
  let lastPromise: Promise<void> = Promise.resolve();

  const ref: SingletonManager<Args, Instance> = {
    instance: undefined,
    create: async (...args: Args): Promise<Instance> => {
      if (instancePromise) {
        throw new Error('Create called twice');
      }

      const promise = lastPromise;
      // eslint-disable-next-line no-async-promise-executor
      instancePromise = new Promise<Instance>(async (resolve) => {
        await promise.finally();
        const instance = await create(...args);
        ref.instance = instance;
        resolve(instance);
      });
      return instancePromise;
    },
    destroy: async (): Promise<void> => {
      if (!instancePromise) {
        throw new Error('Destroy called without an active instance');
      }

      lastPromise = instancePromise.then(async (instance) => {
        ref.instance = undefined;
        await destroy(instance);
      });
      instancePromise = undefined;
      return lastPromise;
    },
  };
  return ref;
};
