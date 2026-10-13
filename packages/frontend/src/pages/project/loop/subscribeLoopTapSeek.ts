import { engine } from '../../../engine/engine.js';
import { isInsideLoop } from './createLoopRangeGesture.js';
import { getLoopPointerFrame } from './loopPointer.js';

const tapSlop = 6;

type Press = {
  pointerId: number;
  clientX: number;
  clientY: number;
};

export const subscribeLoopTapSeek = (overlay: HTMLElement): (() => void) => {
  const area = overlay.parentElement;
  if (!area) {
    return () => undefined;
  }
  let press: Press | undefined = undefined;

  const handlePointerDown = (event: PointerEvent) => {
    press =
      event.isPrimary && event.button === 0
        ? {
            pointerId: event.pointerId,
            clientX: event.clientX,
            clientY: event.clientY,
          }
        : undefined;
  };
  const handlePointerMove = (event: PointerEvent) => {
    if (
      press?.pointerId === event.pointerId &&
      Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY) >
        tapSlop
    ) {
      press = undefined;
    }
  };
  const handlePointerUp = (event: PointerEvent) => {
    const tapped = press?.pointerId === event.pointerId;
    press = undefined;
    const { range, loopStage } = engine.store.get();
    if (!tapped || loopStage !== 'range' || !range) {
      return;
    }
    const frame = getLoopPointerFrame(overlay, event.clientX);
    if (isInsideLoop(range, frame)) {
      engine.player.seek(Math.round(frame), 'spectrogramVisualization');
    }
  };
  const handlePointerCancel = () => {
    press = undefined;
  };

  area.addEventListener('pointerdown', handlePointerDown);
  area.addEventListener('pointermove', handlePointerMove);
  area.addEventListener('pointerup', handlePointerUp);
  area.addEventListener('pointercancel', handlePointerCancel);
  return () => {
    area.removeEventListener('pointerdown', handlePointerDown);
    area.removeEventListener('pointermove', handlePointerMove);
    area.removeEventListener('pointerup', handlePointerUp);
    area.removeEventListener('pointercancel', handlePointerCancel);
  };
};
