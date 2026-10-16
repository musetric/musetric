import { type EngineViewWindow } from '@musetric/engine';
import { engine } from '../../../engine/engine.js';
import { setLoopViewWindow } from './loopView.js';

const minZonePixels = 24;
const zoneRatio = 0.06;
const maxStrength = 2;
const baseGrowthPerSecond = 1.2;
const strengthGrowthPerSecond = 0.8;
const scrollViewsPerSecond = 0.6;
const maxStepSeconds = 0.05;

export type LoopEdgePushMode = 'widen' | 'scroll';

const pushWindow = (
  viewWindow: EngineViewWindow,
  mode: LoopEdgePushMode,
  strength: number,
  seconds: number,
): EngineViewWindow => {
  if (mode === 'scroll') {
    const shift =
      viewWindow.frameCount * scrollViewsPerSecond * strength * seconds;
    return {
      startFrame: Math.round(viewWindow.startFrame + shift),
      frameCount: viewWindow.frameCount,
    };
  }
  const { frameCount = 0 } = engine.store.get();
  const grown = Math.min(
    Math.max(frameCount, viewWindow.frameCount),
    viewWindow.frameCount *
      (baseGrowthPerSecond + strengthGrowthPerSecond * Math.abs(strength)) **
        seconds,
  );
  const startFrame =
    strength > 0
      ? viewWindow.startFrame
      : viewWindow.startFrame + viewWindow.frameCount - grown;
  return {
    startFrame: Math.round(startFrame),
    frameCount: Math.round(grown),
  };
};

export type LoopEdgePush = {
  move: (clientX: number) => void;
  stop: () => void;
};

export const createLoopEdgePush = (
  area: HTMLElement,
  mode: LoopEdgePushMode,
  onPush: (clientX: number) => void,
): LoopEdgePush => {
  let clientX = 0;
  let frame: number | undefined = undefined;
  let last = 0;

  const getStrength = () => {
    const rect = area.getBoundingClientRect();
    const zone = Math.max(minZonePixels, rect.width * zoneRatio);
    const x = clientX - rect.left;
    if (x > rect.width - zone) {
      return Math.min(maxStrength, (x - rect.width + zone) / zone);
    }
    if (x < zone) {
      return -Math.min(maxStrength, (zone - x) / zone);
    }
    return 0;
  };

  const tick = (now: number) => {
    const strength = getStrength();
    const { viewWindow } = engine.store.get();
    if (strength === 0 || !viewWindow) {
      frame = undefined;
      return;
    }
    const seconds = Math.min(maxStepSeconds, (now - last) / 1000);
    last = now;
    setLoopViewWindow(pushWindow(viewWindow, mode, strength, seconds));
    onPush(clientX);
    frame = requestAnimationFrame(tick);
  };

  return {
    move: (nextClientX) => {
      clientX = nextClientX;
      if (frame === undefined && getStrength() !== 0) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    },
    stop: () => {
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
      frame = undefined;
    },
  };
};
