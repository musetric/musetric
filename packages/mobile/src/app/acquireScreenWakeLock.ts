type ForegroundBridge = {
  setActive: (active: boolean) => void;
};

const getForegroundBridge = (): ForegroundBridge | undefined => {
  const value: unknown = Reflect.get(globalThis, 'MusetricForeground');
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const setActive: unknown = Reflect.get(value, 'setActive');
  return typeof setActive === 'function'
    ? { setActive: (active) => Reflect.apply(setActive, value, [active]) }
    : undefined;
};

const setForegroundWorkActive = (active: boolean): void => {
  try {
    getForegroundBridge()?.setActive(active);
  } catch {
    return;
  }
};

type WakeLockSentinel = {
  release: () => Promise<void>;
};

const isWakeLockSentinel = (value: unknown): value is WakeLockSentinel => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return typeof Reflect.get(value, 'release') === 'function';
};

export const acquireScreenWakeLock = async (): Promise<
  WakeLockSentinel | undefined
> => {
  setForegroundWorkActive(true);
  const wakeLock: unknown = Reflect.get(navigator, 'wakeLock');
  const request: unknown =
    wakeLock && typeof wakeLock === 'object'
      ? Reflect.get(wakeLock, 'request')
      : undefined;
  let released = false;
  let sentinel: WakeLockSentinel | undefined = undefined;
  try {
    const result: unknown =
      typeof request === 'function'
        ? await Reflect.apply(request, wakeLock, ['screen'])
        : undefined;
    sentinel = isWakeLockSentinel(result) ? result : undefined;
  } catch {
    sentinel = undefined;
  }
  return {
    release: async () => {
      if (released) {
        return;
      }
      released = true;
      try {
        await sentinel?.release();
      } finally {
        setForegroundWorkActive(false);
      }
    },
  };
};
