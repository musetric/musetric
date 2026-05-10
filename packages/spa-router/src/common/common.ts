export type NativeParams = Record<string, string>;

export const getLocationHash = (): string => {
  const { hash } = window.location;
  const urlWithoutHash = hash.startsWith('#') ? hash.slice(1) : hash;
  const [urlWithoutSearch] = urlWithoutHash.split('?');
  return urlWithoutSearch;
};

export const getLocationSearchParams = (): NativeParams =>
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
  Object.fromEntries(new URLSearchParams(window.location.search) as any);

export const extractPathParams = (
  path: string,
  pattern: string,
): NativeParams | undefined => {
  const regexStr = pattern
    .replace(/:([^/]+)/g, '(?<$1>[^/]+)')
    .replace(/\/\*/g, '(?:/.*)?')
    .replace(/\*/g, '.*');
  const regex = new RegExp(`^${regexStr}$`);

  const match = path.match(regex);
  if (!match) {
    return undefined;
  }

  return match.groups ?? {};
};

export const makePath = (pattern: string, params: NativeParams): string => {
  const normalizedPattern = pattern.replace(/\/\*/g, '').replace(/\*/g, '');

  return normalizedPattern.replace(/:([^/]+)/g, (_, key) => {
    const value = params[key];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (value === undefined) {
      throw new Error(`Missing value for parameter "${key}"`);
    }
    return value;
  });
};
