import {
  isPointerInputType,
  isPrimaryPointerButton,
  type PointerInputType,
} from './pointerType.js';

const touchLockDistance = 8;

const getRatio = (element: HTMLElement, clientX: number) => {
  const rect = element.getBoundingClientRect();
  const width = element.clientWidth;
  if (width <= 0) return 0;
  return Math.max(0, Math.min(1, (clientX - rect.left) / width));
};

const getOffsetRatio = (element: HTMLElement, offset: number) => {
  const width = element.clientWidth;
  if (width <= 0) return 0;
  return offset / width;
};

export type SeekDragUpdate = {
  pointerType: PointerInputType;
  ratio: number;
  offsetRatio: number;
  stop: () => void;
};

export type SeekDragOptions = {
  element: HTMLElement;
  onStart?: () => void;
  onUpdate: (event: SeekDragUpdate) => void;
  onCancel?: () => void;
  onEnd?: () => void;
};

export type SeekDrag = {
  stop: () => void;
  dispose: () => void;
};

type SeekDragInternalState = {
  pointerId: number;
  pointerType: PointerInputType;
  startX: number;
  locked: boolean;
};

export const createSeekDrag = (options: SeekDragOptions): SeekDrag => {
  const { element, onStart, onUpdate, onCancel, onEnd } = options;
  const initialTouchAction = element.style.touchAction;
  const initialUserSelect = element.style.userSelect;
  let state: SeekDragInternalState | undefined = undefined;
  let ended = true;

  const releasePointerCapture = (pointerId: number) => {
    if (element.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
  };

  const finish = () => {
    if (ended) return;
    ended = true;
    onEnd?.();
  };

  const stop = () => {
    const currentState = state;
    if (currentState) {
      releasePointerCapture(currentState.pointerId);
    }
    state = undefined;
    finish();
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (!isPointerInputType(event.pointerType)) return;
    if (!isPrimaryPointerButton(event)) return;
    if (!event.isPrimary) return;

    stop();
    ended = false;
    state = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      locked: event.pointerType !== 'touch',
    };
    element.setPointerCapture(event.pointerId);
    event.preventDefault();
    onStart?.();

    if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
      onUpdate({
        pointerType: event.pointerType,
        ratio: getRatio(element, event.clientX),
        offsetRatio: 0,
        stop,
      });
    }
  };

  const handlePointerMove = (event: PointerEvent) => {
    const currentState = state;
    if (
      currentState === undefined ||
      event.pointerId !== currentState.pointerId
    ) {
      return;
    }
    event.preventDefault();
    if (!currentState.locked) {
      if (Math.abs(event.clientX - currentState.startX) < touchLockDistance) {
        return;
      }
      currentState.locked = true;
      currentState.startX = event.clientX;
    }
    onUpdate({
      pointerType: currentState.pointerType,
      ratio: getRatio(element, event.clientX),
      offsetRatio: getOffsetRatio(element, event.clientX - currentState.startX),
      stop,
    });
  };

  const handlePointerUp = (event: PointerEvent) => {
    const currentState = state;
    if (!currentState || event.pointerId !== currentState.pointerId) return;
    releasePointerCapture(event.pointerId);
    state = undefined;
    finish();
    event.preventDefault();
  };

  const handlePointerCancel = (event: PointerEvent) => {
    const currentState = state;
    if (!currentState || event.pointerId !== currentState.pointerId) return;
    releasePointerCapture(event.pointerId);
    state = undefined;
    onCancel?.();
    finish();
  };

  element.style.touchAction = 'none';
  element.style.userSelect = 'none';
  element.addEventListener('pointerdown', handlePointerDown);
  element.addEventListener('pointermove', handlePointerMove);
  element.addEventListener('pointerup', handlePointerUp);
  element.addEventListener('pointercancel', handlePointerCancel);

  return {
    stop,
    dispose: () => {
      stop();
      element.removeEventListener('pointerdown', handlePointerDown);
      element.removeEventListener('pointermove', handlePointerMove);
      element.removeEventListener('pointerup', handlePointerUp);
      element.removeEventListener('pointercancel', handlePointerCancel);
      element.style.touchAction = initialTouchAction;
      element.style.userSelect = initialUserSelect;
    },
  };
};
