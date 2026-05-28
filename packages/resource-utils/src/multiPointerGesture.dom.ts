import {
  createInertialDragPhysics,
  type InertialDragInertiaState,
  type InertialDragPhysicsOptions,
  type InertialDragVelocityTracker,
} from './inertialDrag.js';

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

type PanState = {
  pointerId: number;
  pointerType: GesturePointerType;
  startX: number;
  startY: number;
  axis: GestureAxis | undefined;
  lastPosition: number;
  velocityTracker: InertialDragVelocityTracker | undefined;
};

type PinchAxisSeed = {
  center: number;
  spread: number;
};

type PinchState = {
  pointerA: number;
  pointerB: number;
  initialX: PinchAxisSeed;
  initialY: PinchAxisSeed;
  axis: GestureAxis | undefined;
};

const defaultPointerTypes: readonly GesturePointerType[] = ['mouse', 'touch'];

const isPointerType = (value: string): value is GesturePointerType =>
  value === 'mouse' || value === 'touch';

export const createMultiPointerGesture = (
  options: MultiPointerGestureOptions,
): MultiPointerGesture => {
  const {
    element,
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
  let panState: PanState | undefined = undefined;
  let pinchState: PinchState | undefined = undefined;
  let inertiaFrame: number | undefined = undefined;
  let inertiaAxis: GestureAxis | undefined = undefined;
  let inertiaState: InertialDragInertiaState | undefined = undefined;

  const releaseCapture = (id: number) => {
    if (element.hasPointerCapture(id)) {
      element.releasePointerCapture(id);
    }
  };

  const stopInertia = () => {
    if (inertiaFrame !== undefined) {
      cancelAnimationFrame(inertiaFrame);
      inertiaFrame = undefined;
    }
    if (inertiaState !== undefined) {
      inertiaState = undefined;
      inertiaAxis = undefined;
      onPanEnd?.();
    }
  };

  const runInertia = (time: number) => {
    if (!inertiaState || !inertiaAxis) {
      inertiaFrame = undefined;
      return;
    }

    const step = physics.advanceInertia(inertiaState, time);
    if (step.done) {
      inertiaFrame = undefined;
      inertiaState = undefined;
      inertiaAxis = undefined;
      onPanEnd?.();
      return;
    }

    const stopFlag = { value: false };
    onPanUpdate?.({
      axis: inertiaAxis,
      phase: 'inertia',
      delta: step.delta,
      velocity: step.velocity,
      stop: () => {
        stopFlag.value = true;
      },
    });

    if (stopFlag.value) {
      inertiaFrame = undefined;
      inertiaState = undefined;
      inertiaAxis = undefined;
      onPanEnd?.();
      return;
    }

    inertiaFrame = requestAnimationFrame(runInertia);
  };

  const endPan = (withInertia: boolean) => {
    const state = panState;
    panState = undefined;
    if (!state || state.axis === undefined) {
      return;
    }

    if (!withInertia) {
      onPanEnd?.();
      return;
    }

    const velocity =
      state.velocityTracker?.release(state.lastPosition, performance.now()) ??
      0;
    inertiaState =
      physics.startInertia(velocity, performance.now()) ?? undefined;
    if (!inertiaState) {
      onPanEnd?.();
      return;
    }
    inertiaAxis = state.axis;
    inertiaFrame = requestAnimationFrame(runInertia);
  };

  const endPinch = () => {
    const state = pinchState;
    pinchState = undefined;
    if (!state || state.axis === undefined) return;
    onPinchEnd?.();
  };

  const startPanFromPointer = (pointer: Pointer) => {
    panState = {
      pointerId: pointer.id,
      pointerType: pointer.type,
      startX: pointer.x,
      startY: pointer.y,
      axis: undefined,
      lastPosition: 0,
      velocityTracker: undefined,
    };
  };

  const startPinchFromPointers = (a: Pointer, b: Pointer) => {
    pinchState = {
      pointerA: a.id,
      pointerB: b.id,
      initialX: {
        center: (a.x + b.x) / 2,
        spread: Math.max(Math.abs(b.x - a.x), minimumPinchSpread),
      },
      initialY: {
        center: (a.y + b.y) / 2,
        spread: Math.max(Math.abs(b.y - a.y), minimumPinchSpread),
      },
      axis: undefined,
    };
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (
      !isPointerType(event.pointerType) ||
      !pointerTypes.includes(event.pointerType)
    ) {
      return;
    }
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    stopInertia();

    const pointer: Pointer = {
      id: event.pointerId,
      type: event.pointerType,
      x: event.clientX,
      y: event.clientY,
    };
    pointers.set(event.pointerId, pointer);

    element.setPointerCapture(event.pointerId);
    event.preventDefault();

    const list = Array.from(pointers.values());
    if (list.length === 1) {
      startPanFromPointer(list[0]);
      return;
    }
    if (list.length === 2) {
      endPan(false);
      startPinchFromPointers(list[0], list[1]);
    }
  };

  const handlePointerMove = (event: PointerEvent) => {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;

    if (pinchState) {
      const a = pointers.get(pinchState.pointerA);
      const b = pointers.get(pinchState.pointerB);
      if (!a || !b) return;

      const spreadX = Math.max(Math.abs(b.x - a.x), minimumPinchSpread);
      const spreadY = Math.max(Math.abs(b.y - a.y), minimumPinchSpread);
      const centerX = (a.x + b.x) / 2;
      const centerY = (a.y + b.y) / 2;

      if (pinchState.axis === undefined) {
        const changeX = Math.abs(spreadX - pinchState.initialX.spread);
        const changeY = Math.abs(spreadY - pinchState.initialY.spread);
        if (Math.max(changeX, changeY) < pinchLockDistance) {
          return;
        }
        pinchState.axis = changeX >= changeY ? 'x' : 'y';
        const seed =
          pinchState.axis === 'x' ? pinchState.initialX : pinchState.initialY;
        onPinchStart?.({
          axis: pinchState.axis,
          center: seed.center,
          spread: seed.spread,
        });
      }

      const { axis } = pinchState;
      onPinchUpdate?.({
        axis,
        center: axis === 'x' ? centerX : centerY,
        spread: axis === 'x' ? spreadX : spreadY,
      });
      event.preventDefault();
      return;
    }

    if (panState && event.pointerId === panState.pointerId) {
      const deltaX = pointer.x - panState.startX;
      const deltaY = pointer.y - panState.startY;

      if (panState.axis === undefined) {
        if (Math.hypot(deltaX, deltaY) < axisLockDistance) return;
        panState.axis = Math.abs(deltaX) >= Math.abs(deltaY) ? 'x' : 'y';
        const startPosition =
          panState.axis === 'x' ? panState.startX : panState.startY;
        panState.lastPosition = startPosition;
        panState.velocityTracker = physics.createVelocityTracker(
          startPosition,
          performance.now(),
        );
        onPanStart?.({
          axis: panState.axis,
          pointerType: panState.pointerType,
        });
      }

      const { axis } = panState;
      const currentPosition = axis === 'x' ? pointer.x : pointer.y;
      const delta = currentPosition - panState.lastPosition;
      panState.lastPosition = currentPosition;
      const velocity = panState.velocityTracker?.add(
        currentPosition,
        performance.now(),
      );

      const stopFlag = { value: false };
      onPanUpdate?.({
        axis,
        phase: 'drag',
        delta,
        velocity: velocity ?? 0,
        stop: () => {
          stopFlag.value = true;
        },
      });

      if (stopFlag.value) {
        endPan(false);
      }
      event.preventDefault();
    }
  };

  const handlePointerUp = (event: PointerEvent) => {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    pointers.delete(event.pointerId);
    releaseCapture(event.pointerId);

    if (
      pinchState &&
      (event.pointerId === pinchState.pointerA ||
        event.pointerId === pinchState.pointerB)
    ) {
      endPinch();
      event.preventDefault();
      return;
    }

    if (panState && event.pointerId === panState.pointerId) {
      endPan(true);
      event.preventDefault();
    }
  };

  const handlePointerCancel = (event: PointerEvent) => {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    pointers.delete(event.pointerId);
    releaseCapture(event.pointerId);

    if (
      pinchState &&
      (event.pointerId === pinchState.pointerA ||
        event.pointerId === pinchState.pointerB)
    ) {
      endPinch();
      return;
    }

    if (panState && event.pointerId === panState.pointerId) {
      endPan(false);
    }
  };

  element.style.touchAction = 'none';
  element.style.userSelect = 'none';
  element.addEventListener('pointerdown', handlePointerDown);
  element.addEventListener('pointermove', handlePointerMove);
  element.addEventListener('pointerup', handlePointerUp);
  element.addEventListener('pointercancel', handlePointerCancel);

  const stop = () => {
    stopInertia();
    if (panState) endPan(false);
    if (pinchState) endPinch();
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
