import { isPointerInputType, isPrimaryPointerButton } from './pointerType.js';
import { createTapTracker } from './tap.js';

export type PointerPressHandlers = {
  press: () => boolean;
  release: (event: PointerEvent, tapped: boolean) => void;
};

export type PointerPress = {
  cancelTap: () => void;
  dispose: () => void;
};

export const subscribePointerPress = (
  element: HTMLElement,
  handlers: PointerPressHandlers,
): PointerPress => {
  const tap = createTapTracker();

  const handleDown = (event: PointerEvent) => {
    if (!isPrimaryPointerButton(event)) return;
    if (!event.isPrimary) return;
    if (!isPointerInputType(event.pointerType)) return;
    if (handlers.press()) {
      tap.press(event);
    } else {
      tap.cancel();
    }
  };

  const handleUp = (event: PointerEvent) => {
    handlers.release(event, tap.release(event));
  };

  const handleCancel = (event: PointerEvent) => {
    tap.cancel();
    handlers.release(event, false);
  };

  element.addEventListener('pointerdown', handleDown, true);
  document.addEventListener('pointermove', tap.move, true);
  document.addEventListener('pointerup', handleUp, true);
  document.addEventListener('pointercancel', handleCancel, true);

  return {
    cancelTap: tap.cancel,
    dispose: () => {
      element.removeEventListener('pointerdown', handleDown, true);
      document.removeEventListener('pointermove', tap.move, true);
      document.removeEventListener('pointerup', handleUp, true);
      document.removeEventListener('pointercancel', handleCancel, true);
    },
  };
};
