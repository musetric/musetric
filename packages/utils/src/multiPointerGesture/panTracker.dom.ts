import {
  type InertialDragPhysics,
  type InertialDragVelocityTracker,
} from '../inertialDrag.js';
import {
  type GestureAxis,
  type GesturePointerType,
} from '../multiPointerGesture.dom.js';

type PanPointer = {
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

export type PanTrackerUpdate = {
  justLockedAxis: boolean;
  axis: GestureAxis;
  pointerType: GesturePointerType;
  delta: number;
  velocity: number;
};

export type PanTrackerEnd = {
  axis: GestureAxis;
  velocity: number;
};

export type PanTracker = {
  start: (pointer: PanPointer) => void;
  update: (pointer: PanPointer) => PanTrackerUpdate | undefined;
  end: () => PanTrackerEnd | undefined;
  cancel: () => void;
  pointerId: () => number | undefined;
};

const resolveAxis = (
  fixedAxis: GestureAxis | undefined,
  axisLockDistance: number,
  deltaX: number,
  deltaY: number,
): GestureAxis | undefined => {
  if (fixedAxis) {
    const axisDelta = fixedAxis === 'x' ? deltaX : deltaY;
    if (Math.abs(axisDelta) < axisLockDistance) {
      return undefined;
    }
    return fixedAxis;
  }
  if (Math.hypot(deltaX, deltaY) < axisLockDistance) {
    return undefined;
  }
  return Math.abs(deltaX) >= Math.abs(deltaY) ? 'x' : 'y';
};

export type CreatePanTrackerOptions = {
  fixedAxis: GestureAxis | undefined;
  axisLockDistance: number;
  physics: InertialDragPhysics;
};

export const createPanTracker = (
  options: CreatePanTrackerOptions,
): PanTracker => {
  const { fixedAxis, axisLockDistance, physics } = options;
  let state: PanState | undefined = undefined;

  const start = (pointer: PanPointer) => {
    state = {
      pointerId: pointer.id,
      pointerType: pointer.type,
      startX: pointer.x,
      startY: pointer.y,
      axis: undefined,
      lastPosition: 0,
      velocityTracker: undefined,
    };
  };

  const update = (pointer: PanPointer): PanTrackerUpdate | undefined => {
    const current = state;
    if (!current || pointer.id !== current.pointerId) return undefined;

    if (current.axis === undefined) {
      const deltaX = pointer.x - current.startX;
      const deltaY = pointer.y - current.startY;
      const resolved = resolveAxis(fixedAxis, axisLockDistance, deltaX, deltaY);
      if (!resolved) return undefined;
      const startPosition = resolved === 'x' ? current.startX : current.startY;
      current.axis = resolved;
      current.lastPosition = startPosition;
      current.velocityTracker = physics.createVelocityTracker(
        startPosition,
        performance.now(),
      );
      const axis: GestureAxis = resolved;
      const currentPosition = axis === 'x' ? pointer.x : pointer.y;
      current.lastPosition = currentPosition;
      const { velocityTracker } = current;
      const velocity = velocityTracker.add(currentPosition, performance.now());
      return {
        justLockedAxis: true,
        axis,
        pointerType: current.pointerType,
        delta: currentPosition - startPosition,
        velocity,
      };
    }

    const { axis } = current;
    const currentPosition = axis === 'x' ? pointer.x : pointer.y;
    const delta = currentPosition - current.lastPosition;
    current.lastPosition = currentPosition;
    const velocity =
      current.velocityTracker?.add(currentPosition, performance.now()) ?? 0;
    return {
      justLockedAxis: false,
      axis,
      pointerType: current.pointerType,
      delta,
      velocity,
    };
  };

  const end = (): PanTrackerEnd | undefined => {
    const current = state;
    state = undefined;
    if (!current || current.axis === undefined) return undefined;
    const velocity =
      current.velocityTracker?.release(
        current.lastPosition,
        performance.now(),
      ) ?? 0;
    return { axis: current.axis, velocity };
  };

  const cancel = () => {
    state = undefined;
  };

  const pointerId = () => state?.pointerId;

  return { start, update, end, cancel, pointerId };
};
