import { engine } from '../../engine/engine.js';

export type HapticKind = 'tick' | 'detent' | 'grab';

const vibrationMs: Record<HapticKind, number> = {
  tick: 5,
  detent: 12,
  grab: 20,
};

type HapticsWindow = Window & {
  webkit?: {
    messageHandlers?: {
      musetricHaptics?: { postMessage: (kind: HapticKind) => void };
    };
  };
  MusetricHaptics?: { perform: (kind: HapticKind) => void };
};

export const playHaptic = (kind: HapticKind): void => {
  if (engine.store.get().recording) {
    return;
  }
  const target: HapticsWindow = window;
  const handler = target.webkit?.messageHandlers?.musetricHaptics;
  if (handler) {
    handler.postMessage(kind);
    return;
  }
  if (target.MusetricHaptics) {
    target.MusetricHaptics.perform(kind);
    return;
  }
  if ('vibrate' in navigator) {
    navigator.vibrate(vibrationMs[kind]);
  }
};

const findCrossedTick = (
  from: number,
  to: number,
  every: number,
): number | undefined => {
  if (to > from) {
    const tick = Math.floor(to / every) * every;
    return tick > from ? tick : undefined;
  }
  if (to < from) {
    const tick = Math.ceil(to / every) * every;
    return tick < from ? tick : undefined;
  }
  return undefined;
};

export const playCrossedTick = (
  from: number,
  to: number,
  every: number,
  isMajor: (tick: number) => boolean,
): void => {
  const tick = findCrossedTick(from, to, every);
  if (tick !== undefined) {
    playHaptic(isMajor(tick) ? 'detent' : 'tick');
  }
};
