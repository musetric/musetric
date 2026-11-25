import {
  isControlPress,
  isPointerInputType,
  isPrimaryPointerButton,
} from './pointerType.js';

export type PointerPressHandlers = {
  press: () => void;
  release: () => void;
};

export const subscribePointerPress = (
  element: HTMLElement,
  handlers: PointerPressHandlers,
): (() => void) => {
  const handleDown = (event: PointerEvent) => {
    if (!isPrimaryPointerButton(event)) return;
    if (!event.isPrimary) return;
    if (!isPointerInputType(event.pointerType)) return;
    if (isControlPress(element, event)) return;
    handlers.press();
  };

  element.addEventListener('pointerdown', handleDown, true);
  document.addEventListener('pointerup', handlers.release, true);
  document.addEventListener('pointercancel', handlers.release, true);

  return () => {
    element.removeEventListener('pointerdown', handleDown, true);
    document.removeEventListener('pointerup', handlers.release, true);
    document.removeEventListener('pointercancel', handlers.release, true);
  };
};
