type IsValueEqual<Value> = (first: Value, second: Value) => boolean;

export type ApplyPatchConfigOptions<Config> = {
  base?: Config;
  draft?: Partial<Config>;
  patch?: Partial<Config>;
  isEqual?: {
    [Key in keyof Config]?: IsValueEqual<Config[Key]>;
  };
};

const isDefaultEqual = (first: unknown, second: unknown) => first === second;

export const applyPatchConfig = <Config>(
  options: ApplyPatchConfigOptions<Config>,
) => {
  const { base, patch } = options;

  if (!patch) {
    return options.draft;
  }

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const keys = Object.keys(patch) as (keyof Config)[];

  const draft: Partial<Config> = { ...options.draft };

  keys.forEach((key) => {
    const isEqual = options.isEqual?.[key] ?? isDefaultEqual;
    const baseValue = base?.[key];
    const draftValue = draft[key];
    const patchValue = patch[key];

    if (patchValue === undefined) {
      return;
    }
    if (baseValue !== undefined && isEqual(baseValue, patchValue)) {
      delete draft[key];
      return;
    }
    if (draftValue !== undefined && isEqual(draftValue, patchValue)) {
      return;
    }

    draft[key] = patchValue;
  });

  if (Object.keys(draft).length === 0) {
    return undefined;
  }

  return draft;
};
