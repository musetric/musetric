import {
  createPanTracker,
  type CreatePanVelocityTracker,
  type PanTracker,
} from './panTracker.js';
import {
  createPinchTracker,
  type PinchTracker,
  type PinchTrackerUpdate,
} from './pinchTracker.js';
import {
  isPointerInputType,
  isPrimaryPointerButton,
  type PointerInputType,
} from './pointerType.js';

const defaultPointerTypes: readonly PointerInputType[] = [
  'mouse',
  'pen',
  'touch',
];

export type GestureModifiers = {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
};

const readModifiers = (event: PointerEvent): GestureModifiers => ({
  shiftKey: event.shiftKey,
  ctrlKey: event.ctrlKey,
  metaKey: event.metaKey,
});

export type GestureAxis = 'x' | 'y';

export type GesturePanUpdate = {
  axis: GestureAxis;
  delta: number;
  velocity: number;
  stop: () => void;
};

type PanUpdateFields = {
  axis: GestureAxis;
  delta: number;
  velocity: number;
};

const emitPanUpdate = (
  onUpdate: (event: GesturePanUpdate) => void,
  fields: PanUpdateFields,
): boolean => {
  let stopped = false;
  onUpdate({
    axis: fields.axis,
    delta: fields.delta,
    velocity: fields.velocity,
    stop: () => {
      stopped = true;
    },
  });
  return stopped;
};

export type GesturePinchUpdate = {
  axis: GestureAxis;
  center: number;
  spread: number;
};

const emitPinchUpdate = (
  onUpdate: ((event: GesturePinchUpdate) => void) | undefined,
  update: PinchTrackerUpdate,
) => {
  onUpdate?.({
    axis: update.axis,
    center: update.center,
    spread: update.spread,
  });
};

export type GesturePanStart = {
  axis: GestureAxis;
  pointerType: PointerInputType;
  startClientX: number;
  startClientY: number;
  modifiers: GestureModifiers;
};

export type GesturePanEnd = {
  axis: GestureAxis;
  velocity: number;
};

export type GesturePinchStart = {
  axis: GestureAxis;
  startCenter: number;
  startSpread: number;
};

export type MultiPointerGestureOptions = {
  element: HTMLElement;
  axis?: GestureAxis;
  pointerTypes?: readonly PointerInputType[];
  axisLockDistance?: number;
  createVelocityTracker?: CreatePanVelocityTracker;
  pinchLockDistance?: number;
  minimumPinchSpread?: number;
  onPanStart: (event: GesturePanStart) => void;
  onPanUpdate: (event: GesturePanUpdate) => void;
  onPanEnd: (event: GesturePanEnd) => void;
  onPanAbort: () => void;
  onPinchStart: (event: GesturePinchStart) => void;
  onPinchUpdate: (event: GesturePinchUpdate) => void;
  onPinchEnd: () => void;
};

export type MultiPointerGesture = {
  stop: () => void;
  dispose: () => void;
};

type Pointer = {
  id: number;
  type: PointerInputType;
  x: number;
  y: number;
};

export const createMultiPointerGesture = (
  options: MultiPointerGestureOptions,
): MultiPointerGesture => {
  const {
    element,
    axis: fixedAxis,
    pointerTypes = defaultPointerTypes,
    axisLockDistance = 6,
    createVelocityTracker,
    pinchLockDistance = 6,
    minimumPinchSpread = 1,
    onPanStart,
    onPanUpdate,
    onPanEnd,
    onPanAbort,
    onPinchStart,
    onPinchUpdate,
    onPinchEnd,
  } = options;

  const initialTouchAction = element.style.touchAction;
  const initialUserSelect = element.style.userSelect;
  const pointers = new Map<number, Pointer>();
  const panTracker: PanTracker = createPanTracker({
    fixedAxis,
    axisLockDistance,
    createVelocityTracker,
  });
  const pinchTracker: PinchTracker = createPinchTracker({
    pinchLockDistance,
    minimumPinchSpread,
  });

  const releaseCapture = (id: number) => {
    if (element.hasPointerCapture(id)) {
      element.releasePointerCapture(id);
    }
  };

  const endPan = (): void => {
    const endInfo = panTracker.end();
    if (endInfo) {
      onPanEnd({ axis: endInfo.axis, velocity: endInfo.velocity });
    }
  };

  const abortPan = (): void => {
    const endInfo = panTracker.end();
    if (endInfo) {
      onPanAbort();
    }
  };

  const endPinch = (): void => {
    if (pinchTracker.end()) {
      onPinchEnd();
    }
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (!isPointerInputType(event.pointerType)) return;
    if (!pointerTypes.includes(event.pointerType)) return;
    if (!isPrimaryPointerButton(event)) return;

    const pointer: Pointer = {
      id: event.pointerId,
      type: event.pointerType,
      x: event.clientX,
      y: event.clientY,
    };
    pointers.set(event.pointerId, pointer);

    element.setPointerCapture(event.pointerId);
    event.stopPropagation();
    event.preventDefault();

    const list = Array.from(pointers.values());
    if (list.length === 1) {
      panTracker.start(list[0]);
      return;
    }
    if (list.length === 2) {
      endPan();
      pinchTracker.start(list[0], list[1]);
    }
  };

  const handlePointerMove = (event: PointerEvent) => {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    event.stopPropagation();
    pointer.x = event.clientX;
    pointer.y = event.clientY;

    if (pinchTracker.matches(event.pointerId)) {
      const aId = pinchTracker.pointerA();
      const bId = pinchTracker.pointerB();
      if (aId === undefined || bId === undefined) return;
      const a = pointers.get(aId);
      const b = pointers.get(bId);
      if (a === undefined || b === undefined) return;

      const update = pinchTracker.update(a, b);
      if (!update) return;

      if (update.justLockedAxis) {
        onPinchStart({
          axis: update.axis,
          startCenter: update.startCenter,
          startSpread: update.startSpread,
        });
      }
      emitPinchUpdate(onPinchUpdate, update);
      event.preventDefault();
      return;
    }

    if (event.pointerId !== panTracker.pointerId()) return;
    const update = panTracker.update(pointer);
    if (!update) return;

    if (update.justLockedAxis) {
      onPanStart({
        axis: update.axis,
        pointerType: update.pointerType,
        startClientX: update.startClientX,
        startClientY: update.startClientY,
        modifiers: readModifiers(event),
      });
    }

    const stopped = emitPanUpdate(onPanUpdate, {
      axis: update.axis,
      delta: update.delta,
      velocity: update.velocity,
    });
    if (stopped) {
      abortPan();
    }
    event.preventDefault();
  };

  const handlePointerUp = (event: PointerEvent) => {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    event.stopPropagation();
    pointers.delete(event.pointerId);
    releaseCapture(event.pointerId);

    if (pinchTracker.matches(event.pointerId)) {
      endPinch();
      event.preventDefault();
      return;
    }

    if (event.pointerId === panTracker.pointerId()) {
      endPan();
      event.preventDefault();
    }
  };

  const handlePointerCancel = (event: PointerEvent) => {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    event.stopPropagation();
    pointers.delete(event.pointerId);
    releaseCapture(event.pointerId);

    if (pinchTracker.matches(event.pointerId)) {
      endPinch();
      return;
    }

    if (event.pointerId === panTracker.pointerId()) {
      abortPan();
    }
  };

  element.style.touchAction = 'none';
  element.style.userSelect = 'none';
  element.addEventListener('pointerdown', handlePointerDown);
  element.addEventListener('pointermove', handlePointerMove);
  element.addEventListener('pointerup', handlePointerUp);
  element.addEventListener('pointercancel', handlePointerCancel);

  const stop = () => {
    abortPan();
    endPinch();
    pointers.forEach((pointer) => releaseCapture(pointer.id));
    pointers.clear();
  };

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
