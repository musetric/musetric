export const extractConfig = <Config>(
  config: Partial<Config>,
  keys: readonly (keyof Config)[],
): Partial<Config> =>
  keys.reduce(
    (result, key) => {
      if (config[key] === undefined) {
        return result;
      }
      return { ...result, [key]: config[key] };
    },
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    {} as Partial<Config>,
  );
