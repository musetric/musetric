import {
  createInertialDragPhysics,
  type InertialDragPhysicsOptions,
} from './inertialDrag.js';
import {
  createInertiaRunner,
  type InertiaRunner,
} from './multiPointerGesture/inertiaRunner.dom.js';
import {
  createPanTracker,
  type PanTracker,
} from './multiPointerGesture/panTracker.dom.js';
import {
  createPinchTracker,
  type PinchTracker,
  type PinchTrackerUpdate,
} from './multiPointerGesture/pinchTracker.dom.js';
import {
  createPointerDispatcher,
  type PointerDispatcher,
} from './multiPointerGesture/pointerDispatcher.dom.js';

export type GestureAxis = 'x' | 'y';
export type GesturePhase = 'drag' | 'inertia';
export type GesturePointerType = 'mouse' | 'touch';

export type GesturePanStart = {
  axis: GestureAxis;
  pointerType: GesturePointerType;
};

export type GesturePanUpdate = {
  axis: GestureAxis;
  phase: GesturePhase;
  delta: number;
  velocity: number;
  stop: () => void;
};

export type GesturePinchStart = {
  axis: GestureAxis;
  center: number;
  spread: number;
};

export type GesturePinchUpdate = {
  axis: GestureAxis;
  center: number;
  spread: number;
};

export type MultiPointerGestureOptions = InertialDragPhysicsOptions & {
  element: HTMLElement;
  axis?: GestureAxis;
  pointerTypes?: readonly GesturePointerType[];
  axisLockDistance?: number;
  pinchLockDistance?: number;
  minimumPinchSpread?: number;
  onPanStart?: (event: GesturePanStart) => void;
  onPanUpdate?: (event: GesturePanUpdate) => void;
  onPanEnd?: () => void;
  onPinchStart?: (event: GesturePinchStart) => void;
  onPinchUpdate?: (event: GesturePinchUpdate) => void;
  onPinchEnd?: () => void;
};

export type MultiPointerGesture = {
  stop: () => void;
  dispose: () => void;
};

type Pointer = {
  id: number;
  type: GesturePointerType;
  x: number;
  y: number;
};

const defaultPointerTypes: readonly GesturePointerType[] = ['mouse', 'touch'];

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

type PanUpdateFields = {
  axis: GestureAxis;
  delta: number;
  velocity: number;
};

const emitPanUpdate = (
  onUpdate: ((event: GesturePanUpdate) => void) | undefined,
  phase: GesturePhase,
  update: PanUpdateFields,
): boolean => {
  let stopped = false;
  onUpdate?.({
    axis: update.axis,
    phase,
    delta: update.delta,
    velocity: update.velocity,
    stop: () => {
      stopped = true;
    },
  });
  return stopped;
};

export const createMultiPointerGesture = (
  options: MultiPointerGestureOptions,
): MultiPointerGesture => {
  const {
    element,
    axis: fixedAxis,
    pointerTypes = defaultPointerTypes,
    axisLockDistance = 6,
    pinchLockDistance = 6,
    minimumPinchSpread = 1,
    inertiaTimeConstantMs,
    inertiaMinimumVelocity,
    inertiaVelocityMultiplier,
    stationaryDistance,
    stationaryVelocityResetMs,
    velocitySampleDurationMs,
    onPanStart,
    onPanUpdate,
    onPanEnd,
    onPinchStart,
    onPinchUpdate,
    onPinchEnd,
  } = options;

  const physics = createInertialDragPhysics({
    inertiaTimeConstantMs,
    inertiaMinimumVelocity,
    inertiaVelocityMultiplier,
    stationaryDistance,
    stationaryVelocityResetMs,
    velocitySampleDurationMs,
  });

  const initialTouchAction = element.style.touchAction;
  const initialUserSelect = element.style.userSelect;

  const pointers = new Map<number, Pointer>();
  const panTracker: PanTracker = createPanTracker({
    fixedAxis,
    axisLockDistance,
    physics,
  });
  const pinchTracker: PinchTracker = createPinchTracker({
    pinchLockDistance,
    minimumPinchSpread,
  });
  const inertiaRunner: InertiaRunner = createInertiaRunner(physics, {
    onUpdate: (info) => emitPanUpdate(onPanUpdate, 'inertia', info),
    onEnd: () => onPanEnd?.(),
  });

  const releaseCapture = (id: number) => {
    if (element.hasPointerCapture(id)) {
      element.releasePointerCapture(id);
    }
  };

  const endPanWithoutInertia = () => {
    if (panTracker.end()) {
      onPanEnd?.();
    }
  };

  const endPinch = () => {
    if (pinchTracker.end()) {
      onPinchEnd?.();
    }
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse' && event.pointerType !== 'touch') {
      return;
    }
    inertiaRunner.stop(true);

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
      endPanWithoutInertia();
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
      if (!a || !b) return;

      const update = pinchTracker.update(a, b);
      if (!update) return;

      if (update.justLockedAxis) {
        onPinchStart?.({
          axis: update.axis,
          center: update.startCenter,
          spread: update.startSpread,
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
      onPanStart?.({
        axis: update.axis,
        pointerType: update.pointerType,
      });
    }

    const stopped = emitPanUpdate(onPanUpdate, 'drag', update);
    if (stopped) {
      endPanWithoutInertia();
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
      const endInfo = panTracker.end();
      if (endInfo) {
        inertiaRunner.start(endInfo.velocity, endInfo.axis, performance.now());
      }
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
      endPanWithoutInertia();
    }
  };

  const dispatcher: PointerDispatcher = createPointerDispatcher({
    element,
    pointerTypes,
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerCancel,
  });

  element.style.touchAction = 'none';
  element.style.userSelect = 'none';
  dispatcher.attach();

  const stop = () => {
    inertiaRunner.stop(true);
    endPanWithoutInertia();
    endPinch();
    pointers.forEach((pointer) => releaseCapture(pointer.id));
    pointers.clear();
  };

  return {
    stop,
    dispose: () => {
      stop();
      dispatcher.detach();
      element.style.touchAction = initialTouchAction;
      element.style.userSelect = initialUserSelect;
    },
  };
};
