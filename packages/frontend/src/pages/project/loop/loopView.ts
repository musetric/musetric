import { type EngineRange, type EngineViewWindow } from '@musetric/engine';
import { engine } from '../../../engine/engine.js';
import { useSettingsStore } from '../settings/store.js';

const targetFill = 1 / 2;
const minFill = 1 / 3;
const maxFill = 2 / 3;
const minMarginRatio = 1 / 6;
const animationMilliseconds = 220;

const setViewWindow = (viewWindow: EngineViewWindow | undefined) => {
  engine.store.update((state) => {
    state.viewWindow = viewWindow;
  });
};

const getFollowWindow = (): EngineViewWindow => {
  const { visibleTime, playheadRatio } = useSettingsStore.getState();
  const frameCount = visibleTime * engine.context.sampleRate;
  return {
    startFrame: Math.round(
      engine.store.get().frameIndex - playheadRatio * frameCount,
    ),
    frameCount: Math.round(frameCount),
  };
};

const getCenter = (viewWindow: EngineViewWindow) =>
  viewWindow.startFrame + viewWindow.frameCount / 2;

const centerOn = (range: EngineRange, frameCount: number) => ({
  startFrame: Math.round((range.fromFrame + range.toFrame - frameCount) / 2),
  frameCount: Math.round(frameCount),
});

const getLoopWindow = (
  range: EngineRange,
  current: EngineViewWindow | undefined,
): EngineViewWindow | undefined => {
  const length = range.toFrame - range.fromFrame;
  if (!current) {
    return centerOn(range, length / targetFill);
  }
  const fill = length / current.frameCount;
  if (fill < minFill || fill > maxFill) {
    return centerOn(range, length / targetFill);
  }
  const margin = current.frameCount * minMarginRatio;
  const inside =
    range.fromFrame >= current.startFrame + margin &&
    range.toFrame <= current.startFrame + current.frameCount - margin;
  return inside ? undefined : centerOn(range, current.frameCount);
};

const sameWindow = (
  left: EngineViewWindow | undefined,
  right: EngineViewWindow | undefined,
) =>
  left?.startFrame === right?.startFrame &&
  left?.frameCount === right?.frameCount;

const animateTo = (getTarget: () => EngineViewWindow, hiding: boolean) => {
  const from = engine.store.get().viewWindow ?? getFollowWindow();
  const started = performance.now();
  let current = engine.store.get().viewWindow;
  const step = (now: number) => {
    const state = engine.store.get();
    const interrupted = hiding
      ? state.loopStage === 'range'
      : state.loopStage === undefined || !sameWindow(state.viewWindow, current);
    if (interrupted) {
      return;
    }
    const progress = Math.min(1, (now - started) / animationMilliseconds);
    const eased = 1 - (1 - progress) ** 3;
    const target = getTarget();
    const frameCount =
      from.frameCount * (target.frameCount / from.frameCount) ** eased;
    const center =
      getCenter(from) + (getCenter(target) - getCenter(from)) * eased;
    current = {
      startFrame: Math.round(center - frameCount / 2),
      frameCount: Math.round(frameCount),
    };
    setViewWindow(current);
    if (progress < 1) {
      requestAnimationFrame(step);
      return;
    }
    if (hiding) {
      setViewWindow(undefined);
    }
  };
  requestAnimationFrame(step);
};

export const setLoopViewWindow = (viewWindow: EngineViewWindow) => {
  setViewWindow(viewWindow);
};

export const showLoopView = (range: EngineRange) => {
  const target = getLoopWindow(range, engine.store.get().viewWindow);
  if (target) {
    animateTo(() => target, false);
  }
};

export const hideLoopView = () => {
  if (engine.store.get().viewWindow) {
    animateTo(getFollowWindow, true);
  }
};
