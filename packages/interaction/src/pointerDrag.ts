import {
  isControlPress,
  isPointerInputType,
  isPrimaryPointerButton,
} from './pointerType.js';

export type PointerDragSession = {
  move?: (event: PointerEvent) => void;
  end?: () => void;
  cancel?: () => void;
};

export type PointerDrag = {
  stop: () => void;
  dispose: () => void;
};

export const createPointerDrag = (
  element: HTMLElement,
  start: (event: PointerEvent) => PointerDragSession | undefined,
): PointerDrag => {
  const { touchAction, userSelect } = element.style;
  const listening = new AbortController();
  const options = { capture: true, signal: listening.signal };
  let pointerId: number | undefined = undefined;
  let session: PointerDragSession | undefined = undefined;

  const close = () => {
    const closed = session;
    if (pointerId !== undefined && element.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
    pointerId = undefined;
    session = undefined;
    return closed;
  };

  const stop = () => {
    close()?.end?.();
  };

  const cancel = () => {
    close()?.cancel?.();
  };

  element.addEventListener(
    'pointerdown',
    (event) => {
      if (
        !event.isPrimary ||
        !isPointerInputType(event.pointerType) ||
        !isPrimaryPointerButton(event) ||
        isControlPress(element, event)
      ) {
        return;
      }
      stop();
      const captured = element.hasPointerCapture(event.pointerId);
      element.setPointerCapture(event.pointerId);
      session = start(event);
      if (session) {
        pointerId = event.pointerId;
      } else if (!captured) {
        element.releasePointerCapture(event.pointerId);
      }
    },
    options,
  );
  element.addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerId === pointerId) {
        session?.move?.(event);
      }
    },
    options,
  );
  element.addEventListener(
    'pointerup',
    (event) => {
      if (event.pointerId === pointerId) {
        stop();
      }
    },
    options,
  );
  element.addEventListener(
    'pointercancel',
    (event) => {
      if (event.pointerId === pointerId) {
        cancel();
      }
    },
    options,
  );
  element.style.touchAction = 'none';
  element.style.userSelect = 'none';

  return {
    stop,
    dispose: () => {
      listening.abort();
      cancel();
      element.style.touchAction = touchAction;
      element.style.userSelect = userSelect;
    },
  };
};
