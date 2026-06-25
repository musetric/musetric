import {
  createInertialDragPhysics,
  type InertialDragInertiaState,
  type InertialDragPhysicsOptions,
  type InertialDragVelocityTracker,
} from './inertialDrag.js';

export type InertialDragPointerType = 'mouse' | 'touch';

export type InertialDragPhase = 'drag' | 'inertia';

export type InertialDragUpdate = {
  phase: InertialDragPhase;
  delta: number;
  position: number;
  velocity: number;
  stop: () => void;
};

export type InertialDragStart = {
  pointerType: InertialDragPointerType;
};

export type InertialDragOptions = InertialDragPhysicsOptions & {
  element: HTMLElement;
  axis?: 'x' | 'y';
  pointerTypes?: readonly InertialDragPointerType[];
  dragStartDistance?: number;
  onStart?: (event: InertialDragStart) => void;
  onUpdate: (event: InertialDragUpdate) => void;
  onEnd?: () => void;
};

export type InertialDrag = {
  stop: () => void;
  dispose: () => void;
};

type InertialDragState = {
  pointerId: number;
  pointerType: InertialDragPointerType;
  startPosition: number;
  previousPosition: number;
  dragStarted: boolean;
  velocityTracker: InertialDragVelocityTracker;
};

const defaultPointerTypes: readonly InertialDragPointerType[] = [
  'mouse',
  'touch',
];

const defaultDragStartDistance = 2;

const isInertialDragPointerType = (
  pointerType: string,
): pointerType is InertialDragPointerType =>
  pointerType === 'mouse' || pointerType === 'touch';

const getEventPosition = (event: PointerEvent, axis: 'x' | 'y') => {
  if (axis === 'x') {
    return event.clientX;
  }

  return event.clientY;
};

export const createInertialDrag = (
  options: InertialDragOptions,
): InertialDrag => {
  const {
    element,
    axis = 'x',
    pointerTypes = defaultPointerTypes,
    dragStartDistance = defaultDragStartDistance,
    inertiaTimeConstantMs,
    inertiaMinimumVelocity,
    inertiaVelocityMultiplier,
    stationaryDistance,
    stationaryVelocityResetMs,
    velocitySampleDurationMs,
    onStart,
    onUpdate,
    onEnd,
  } = options;

  const initialTouchAction = element.style.touchAction;
  const initialUserSelect = element.style.userSelect;
  let state: InertialDragState | undefined = undefined;
  let inertiaFrame: number | undefined = undefined;
  let inertiaState: InertialDragInertiaState | undefined = undefined;
  let position = 0;
  let ended = true;
  let started = false;
  const physics = createInertialDragPhysics({
    inertiaTimeConstantMs,
    inertiaMinimumVelocity,
    inertiaVelocityMultiplier,
    stationaryDistance,
    stationaryVelocityResetMs,
    velocitySampleDurationMs,
  });

  const finish = () => {
    if (ended) {
      return;
    }

    ended = true;

    if (!started) {
      return;
    }

    started = false;
    onEnd?.();
  };

  const stopInertia = () => {
    if (inertiaFrame === undefined) {
      return;
    }

    cancelAnimationFrame(inertiaFrame);
    inertiaFrame = undefined;
  };

  const releasePointerCapture = (pointerId: number) => {
    if (!element.hasPointerCapture(pointerId)) {
      return;
    }

    element.releasePointerCapture(pointerId);
  };

  const stop = () => {
    const currentState = state;
    if (currentState) {
      releasePointerCapture(currentState.pointerId);
    }

    stopInertia();
    state = undefined;
    finish();
  };

  const dispatchUpdate = (
    phase: InertialDragPhase,
    delta: number,
    velocity: number,
  ) => {
    position += delta;
    onUpdate({
      phase,
      delta,
      position,
      velocity,
      stop,
    });
  };

  const runInertia = (time: number) => {
    if (!inertiaState) {
      inertiaFrame = undefined;
      finish();
      return;
    }

    const step = physics.advanceInertia(inertiaState, time);

    if (step.done) {
      inertiaFrame = undefined;
      inertiaState = undefined;
      finish();
      return;
    }

    dispatchUpdate('inertia', step.delta, step.velocity);

    if (ended) {
      inertiaFrame = undefined;
      inertiaState = undefined;
      return;
    }

    inertiaFrame = requestAnimationFrame(runInertia);
  };

  const startInertia = (velocity: number) => {
    inertiaState = physics.startInertia(velocity, performance.now());

    if (!inertiaState) {
      finish();
      return;
    }

    inertiaFrame = requestAnimationFrame(runInertia);
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (!isInertialDragPointerType(event.pointerType)) {
      return;
    }

    if (!pointerTypes.includes(event.pointerType)) {
      return;
    }

    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    if (!event.isPrimary) {
      return;
    }

    stop();

    ended = false;
    started = false;
    position = 0;

    const pointerPosition = getEventPosition(event, axis);
    const time = performance.now();
    state = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startPosition: pointerPosition,
      previousPosition: pointerPosition,
      dragStarted: false,
      velocityTracker: physics.createVelocityTracker(pointerPosition, time),
    };

    element.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const startDrag = (currentState: InertialDragState) => {
    currentState.dragStarted = true;
    started = true;
    onStart?.({ pointerType: currentState.pointerType });
  };

  const handlePointerMove = (event: PointerEvent) => {
    const currentState = state;

    if (!currentState || event.pointerId !== currentState.pointerId) {
      return;
    }

    const pointerPosition = getEventPosition(event, axis);
    const distance = pointerPosition - currentState.startPosition;

    if (!currentState.dragStarted && Math.abs(distance) < dragStartDistance) {
      return;
    }

    if (!currentState.dragStarted) {
      startDrag(currentState);
    }

    const delta = pointerPosition - currentState.previousPosition;
    const time = performance.now();
    currentState.previousPosition = pointerPosition;
    const velocity = currentState.velocityTracker.add(pointerPosition, time);

    dispatchUpdate('drag', delta, velocity);
    event.preventDefault();
  };

  const handlePointerUp = (event: PointerEvent) => {
    const currentState = state;

    if (!currentState || event.pointerId !== currentState.pointerId) {
      return;
    }

    releasePointerCapture(event.pointerId);
    state = undefined;

    if (!currentState.dragStarted) {
      finish();
      return;
    }

    startInertia(
      currentState.velocityTracker.release(
        getEventPosition(event, axis),
        performance.now(),
      ),
    );
    event.preventDefault();
  };

  const handlePointerCancel = (event: PointerEvent) => {
    const currentState = state;

    if (!currentState || event.pointerId !== currentState.pointerId) {
      return;
    }

    releasePointerCapture(event.pointerId);
    state = undefined;
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
