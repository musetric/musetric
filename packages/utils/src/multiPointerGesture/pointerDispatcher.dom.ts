import { type GesturePointerType } from '../multiPointerGesture.dom.js';

const isPointerType = (value: string): value is GesturePointerType =>
  value === 'mouse' || value === 'touch';

export type PointerDispatcher = {
  attach: () => void;
  detach: () => void;
};

type PointerDispatcherDeps = {
  element: HTMLElement;
  pointerTypes: readonly GesturePointerType[];
  onPointerDown: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
  onPointerCancel: (event: PointerEvent) => void;
};

export const createPointerDispatcher = (
  deps: PointerDispatcherDeps,
): PointerDispatcher => {
  const {
    element,
    pointerTypes,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  } = deps;

  const acceptsPointerType = (pointerType: string): boolean =>
    isPointerType(pointerType) && pointerTypes.includes(pointerType);

  const handleDown = (event: PointerEvent) => {
    if (!acceptsPointerType(event.pointerType)) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    onPointerDown(event);
  };
  const handleMove = (event: PointerEvent) => {
    if (!acceptsPointerType(event.pointerType)) return;
    onPointerMove(event);
  };
  const handleUp = (event: PointerEvent) => {
    if (!acceptsPointerType(event.pointerType)) return;
    onPointerUp(event);
  };
  const handleCancel = (event: PointerEvent) => {
    if (!acceptsPointerType(event.pointerType)) return;
    onPointerCancel(event);
  };

  return {
    attach: () => {
      element.addEventListener('pointerdown', handleDown);
      element.addEventListener('pointermove', handleMove);
      element.addEventListener('pointerup', handleUp);
      element.addEventListener('pointercancel', handleCancel);
    },
    detach: () => {
      element.removeEventListener('pointerdown', handleDown);
      element.removeEventListener('pointermove', handleMove);
      element.removeEventListener('pointerup', handleUp);
      element.removeEventListener('pointercancel', handleCancel);
    },
  };
};
