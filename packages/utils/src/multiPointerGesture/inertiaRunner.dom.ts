import {
  type InertialDragInertiaState,
  type InertialDragInertiaStep,
  type InertialDragPhysics,
} from '../inertialDrag.js';
import { type GestureAxis } from '../multiPointerGesture.dom.js';

export type InertiaRunnerUpdate = {
  axis: GestureAxis;
  delta: number;
  velocity: number;
};

export type InertiaRunnerHandlers = {
  onUpdate: (update: InertiaRunnerUpdate) => boolean;
  onEnd: () => void;
};

export type InertiaRunner = {
  start: (velocity: number, axis: GestureAxis, time: number) => void;
  stop: (notifyEnd: boolean) => void;
};

export const createInertiaRunner = (
  physics: InertialDragPhysics,
  handlers: InertiaRunnerHandlers,
): InertiaRunner => {
  let frame: number | undefined = undefined;
  let state: InertialDragInertiaState | undefined = undefined;
  let axis: GestureAxis | undefined = undefined;

  const clear = () => {
    state = undefined;
    axis = undefined;
  };

  const runFrame = (time: number) => {
    if (!state || !axis) {
      frame = undefined;
      return;
    }

    const step: InertialDragInertiaStep = physics.advanceInertia(state, time);
    if (step.done) {
      frame = undefined;
      clear();
      handlers.onEnd();
      return;
    }

    const stopped = handlers.onUpdate({
      axis,
      delta: step.delta,
      velocity: step.velocity,
    });

    if (stopped) {
      frame = undefined;
      clear();
      handlers.onEnd();
      return;
    }

    frame = requestAnimationFrame(runFrame);
  };

  const stop = (notifyEnd: boolean) => {
    if (frame !== undefined) {
      cancelAnimationFrame(frame);
      frame = undefined;
    }
    if (state !== undefined) {
      clear();
      if (notifyEnd) {
        handlers.onEnd();
      }
    }
  };

  const start = (velocity: number, nextAxis: GestureAxis, time: number) => {
    stop(false);
    const nextState = physics.startInertia(velocity, time);
    if (!nextState) {
      handlers.onEnd();
      return;
    }
    state = nextState;
    axis = nextAxis;
    frame = requestAnimationFrame(runFrame);
  };

  return { start, stop };
};
