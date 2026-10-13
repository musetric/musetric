import { type EngineRange } from '@musetric/engine';
import {
  type GesturePanStart,
  type ViewportCustomPan,
} from '@musetric/interaction';
import { engine } from '../../../engine/engine.js';
import { moveLoop } from './loopActions.js';
import { createLoopEdgePush } from './loopEdgePush.js';
import { getLoopPointerFrame } from './loopPointer.js';

const shiftRange = (range: EngineRange, offset: number): EngineRange => {
  const { frameCount = 0 } = engine.store.get();
  const length = range.toFrame - range.fromFrame;
  const fromFrame = Math.round(
    Math.min(frameCount - length, Math.max(0, range.fromFrame + offset)),
  );
  return { fromFrame, toFrame: fromFrame + length };
};

const startMove = (
  area: HTMLElement,
  startClientX: number,
  range: EngineRange,
): ViewportCustomPan => {
  const grab = getLoopPointerFrame(area, startClientX);
  let clientX = startClientX;
  const shift = (x: number) => {
    engine.player.setRange(
      shiftRange(range, getLoopPointerFrame(area, x) - grab),
    );
  };
  const push = createLoopEdgePush(area, 'scroll', shift);
  return {
    update: (delta) => {
      clientX += delta;
      push.move(clientX);
      shift(clientX);
    },
    end: () => {
      push.stop();
      const { range: moved } = engine.store.get();
      if (moved) {
        moveLoop(moved);
      }
    },
  };
};

const ignoredPan: ViewportCustomPan = {
  update: () => undefined,
  end: () => undefined,
};

export const isInsideLoop = (range: EngineRange, frame: number): boolean =>
  frame >= range.fromFrame && frame <= range.toFrame;

export const createLoopRangeGesture =
  (area: HTMLElement) =>
  (event: GesturePanStart): ViewportCustomPan | undefined => {
    const { loopStage, range } = engine.store.get();
    if (event.axis !== 'x' || loopStage !== 'range') {
      return undefined;
    }
    const frame = getLoopPointerFrame(area, event.startClientX);
    return range && isInsideLoop(range, frame)
      ? startMove(area, event.startClientX, range)
      : ignoredPan;
  };
