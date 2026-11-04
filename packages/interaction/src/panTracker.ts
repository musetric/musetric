import { type InertialDragVelocityTracker } from './inertialDrag.js';
import { type GestureAxis } from './multiPointerGesture.js';
import { type PointerInputType } from './pointerType.js';

const xLockDistance = 8;
const yLockDistance = 16;
const yDominance = 2;
const undecidedLockDistance = 24;

const resolveAxis = (
  deltaX: number,
  deltaY: number,
): GestureAxis | undefined => {
  const x = Math.abs(deltaX);
  const y = Math.abs(deltaY);
  if (x >= xLockDistance && x >= y) return 'x';
  if (y >= yLockDistance && y >= x * yDominance) return 'y';
  if (Math.hypot(x, y) < undecidedLockDistance) return undefined;
  return x >= y ? 'x' : 'y';
};

export type CreatePanVelocityTracker = (
  position: number,
  time: number,
) => InertialDragVelocityTracker;

export type CreatePanTrackerOptions = {
  createVelocityTracker: CreatePanVelocityTracker | undefined;
};

type PanState = {
  pointerId: number;
  pointerType: PointerInputType;
  startX: number;
  startY: number;
  axis: GestureAxis | undefined;
  lastPosition: number;
  velocityTracker: InertialDragVelocityTracker | undefined;
};

type PanPointer = {
  id: number;
  type: PointerInputType;
  x: number;
  y: number;
};

export type PanTrackerUpdate = {
  justLockedAxis: boolean;
  axis: GestureAxis;
  pointerType: PointerInputType;
  startClientX: number;
  startClientY: number;
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
  pointerId: () => number | undefined;
};

export const createPanTracker = (
  options: CreatePanTrackerOptions,
): PanTracker => {
  const { createVelocityTracker } = options;
  let state: PanState | undefined = undefined;

  return {
    start: (pointer) => {
      state = {
        pointerId: pointer.id,
        pointerType: pointer.type,
        startX: pointer.x,
        startY: pointer.y,
        axis: undefined,
        lastPosition: 0,
        velocityTracker: undefined,
      };
    },
    update: (pointer) => {
      const current = state;
      if (current === undefined || pointer.id !== current.pointerId) {
        return undefined;
      }

      if (current.axis === undefined) {
        const deltaX = pointer.x - current.startX;
        const deltaY = pointer.y - current.startY;
        const axis = resolveAxis(deltaX, deltaY);
        if (!axis) return undefined;
        const lockPosition = axis === 'x' ? pointer.x : pointer.y;
        current.axis = axis;
        current.lastPosition = lockPosition;
        current.velocityTracker = createVelocityTracker?.(
          lockPosition,
          performance.now(),
        );
        return {
          justLockedAxis: true,
          axis,
          pointerType: current.pointerType,
          startClientX: current.startX,
          startClientY: current.startY,
          delta: 0,
          velocity: 0,
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
        startClientX: current.startX,
        startClientY: current.startY,
        delta,
        velocity,
      };
    },
    end: () => {
      const current = state;
      state = undefined;
      if (!current || current.axis === undefined) return undefined;
      const velocity =
        current.velocityTracker?.release(
          current.lastPosition,
          performance.now(),
        ) ?? 0;
      return { axis: current.axis, velocity };
    },
    pointerId: () => state?.pointerId,
  };
};
