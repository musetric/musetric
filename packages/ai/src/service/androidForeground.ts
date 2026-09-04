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

const state = { holders: 0 };

export const setAndroidForegroundWork = (active: boolean): void => {
  if (active) {
    state.holders += 1;
    if (state.holders === 1) {
      getForegroundBridge()?.setActive(true);
    }
    return;
  }
  state.holders = Math.max(0, state.holders - 1);
  if (state.holders === 0) {
    getForegroundBridge()?.setActive(false);
  }
};
