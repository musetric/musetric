import { type GestureAxis } from './multiPointerGesture.js';

type PinchPointer = {
  id: number;
  x: number;
  y: number;
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

export type PinchTrackerUpdate =
  | {
      justLockedAxis: true;
      axis: GestureAxis;
      center: number;
      spread: number;
      startCenter: number;
      startSpread: number;
    }
  | {
      justLockedAxis: false;
      axis: GestureAxis;
      center: number;
      spread: number;
    };

export type PinchTracker = {
  start: (a: PinchPointer, b: PinchPointer) => void;
  update: (a: PinchPointer, b: PinchPointer) => PinchTrackerUpdate | undefined;
  end: () => boolean;
  matches: (pointerId: number) => boolean;
  pointerA: () => number | undefined;
  pointerB: () => number | undefined;
};

export type CreatePinchTrackerOptions = {
  pinchLockDistance: number;
  minimumPinchSpread: number;
};

export const createPinchTracker = (
  options: CreatePinchTrackerOptions,
): PinchTracker => {
  const { pinchLockDistance, minimumPinchSpread } = options;
  let state: PinchState | undefined = undefined;

  const spread = (delta: number) =>
    Math.max(Math.abs(delta), minimumPinchSpread);

  return {
    start: (a, b) => {
      state = {
        pointerA: a.id,
        pointerB: b.id,
        initialX: {
          center: (a.x + b.x) / 2,
          spread: spread(a.x - b.x),
        },
        initialY: {
          center: (a.y + b.y) / 2,
          spread: spread(a.y - b.y),
        },
        axis: undefined,
      };
    },
    update: (a, b) => {
      const current = state;
      if (
        current === undefined ||
        current.pointerA !== a.id ||
        current.pointerB !== b.id
      ) {
        return undefined;
      }

      const spreadX = spread(a.x - b.x);
      const spreadY = spread(a.y - b.y);
      const centerX = (a.x + b.x) / 2;
      const centerY = (a.y + b.y) / 2;

      if (current.axis === undefined) {
        const changeX = Math.abs(spreadX - current.initialX.spread);
        const changeY = Math.abs(spreadY - current.initialY.spread);
        if (Math.max(changeX, changeY) < pinchLockDistance) return undefined;
        const axis: GestureAxis = changeX >= changeY ? 'x' : 'y';
        current.axis = axis;
        const seed = axis === 'x' ? current.initialX : current.initialY;
        return {
          justLockedAxis: true,
          axis,
          center: axis === 'x' ? centerX : centerY,
          spread: axis === 'x' ? spreadX : spreadY,
          startCenter: seed.center,
          startSpread: seed.spread,
        };
      }

      const { axis } = current;
      return {
        justLockedAxis: false,
        axis,
        center: axis === 'x' ? centerX : centerY,
        spread: axis === 'x' ? spreadX : spreadY,
      };
    },
    end: () => {
      const current = state;
      state = undefined;
      return current !== undefined && current.axis !== undefined;
    },
    matches: (pointerId) =>
      state !== undefined &&
      (pointerId === state.pointerA || pointerId === state.pointerB),
    pointerA: () => state?.pointerA,
    pointerB: () => state?.pointerB,
  };
};
