import { engine } from '../../../engine/engine.js';
import { isInsideLoop } from './createLoopRangeGesture.js';
import { getLoopPointerFrame } from './loopPointer.js';

export const subscribeLoopGrabCursor = (overlay: HTMLElement): (() => void) => {
  const area = overlay.parentElement;
  if (!area) {
    return () => undefined;
  }
  const handlePointerMove = (event: PointerEvent) => {
    if (event.buttons !== 0) {
      return;
    }
    const { range, loopStage } = engine.store.get();
    const inside =
      loopStage === 'range' &&
      range !== undefined &&
      isInsideLoop(range, getLoopPointerFrame(overlay, event.clientX));
    area.style.cursor = inside ? 'grab' : '';
  };
  area.addEventListener('pointermove', handlePointerMove);
  return () => {
    area.removeEventListener('pointermove', handlePointerMove);
    area.style.cursor = '';
  };
};
