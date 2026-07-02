import { type InertialDragPhysicsOptions } from './inertialDrag.js';
import {
  createMultiPointerGesture,
  type GestureAxis,
  type GesturePanStart,
  type GesturePanUpdate,
  type GesturePhase,
  type GesturePointerType,
  type MultiPointerGesture,
} from './multiPointerGesture.dom.js';

export type InertialDragPointerType = GesturePointerType;

export type InertialDragPhase = GesturePhase;

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
  axis?: GestureAxis;
  pointerTypes?: readonly InertialDragPointerType[];
  dragStartDistance?: number;
  onStart?: (event: InertialDragStart) => void;
  onUpdate: (event: InertialDragUpdate) => void;
  onEnd?: () => void;
};

export type InertialDrag = MultiPointerGesture;

const defaultDragStartDistance = 2;

export const createInertialDrag = (
  options: InertialDragOptions,
): InertialDrag => {
  const {
    element,
    axis = 'x',
    pointerTypes,
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

  let position = 0;

  const handlePanStart = (event: GesturePanStart) => {
    position = 0;
    onStart?.({
      pointerType: event.pointerType,
    });
  };

  const handlePanUpdate = (event: GesturePanUpdate) => {
    position += event.delta;
    onUpdate({
      phase: event.phase,
      delta: event.delta,
      position,
      velocity: event.velocity,
      stop: event.stop,
    });
  };

  return createMultiPointerGesture({
    element,
    axis,
    pointerTypes,
    axisLockDistance: dragStartDistance,
    inertiaTimeConstantMs,
    inertiaMinimumVelocity,
    inertiaVelocityMultiplier,
    stationaryDistance,
    stationaryVelocityResetMs,
    velocitySampleDurationMs,
    onPanStart: handlePanStart,
    onPanUpdate: handlePanUpdate,
    onPanEnd: onEnd,
  });
};
