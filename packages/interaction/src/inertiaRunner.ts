import {
  type InertialDragInertiaState,
  type InertialDragInertiaStep,
  type InertialDragPhysics,
} from './inertialDrag.js';

export type InertiaRunnerUpdate<Axis extends string> = {
  axis: Axis;
  delta: number;
  velocity: number;
};

export type InertiaRunnerHandlers<Axis extends string> = {
  onUpdate: (update: InertiaRunnerUpdate<Axis>) => boolean;
  onEnd: () => void;
};

export type InertiaRunner<Axis extends string> = {
  start: (velocity: number, axis: Axis, time: number) => void;
  stop: (notifyEnd: boolean) => void;
};

export const createInertiaRunner = <Axis extends string>(
  physics: InertialDragPhysics,
  handlers: InertiaRunnerHandlers<Axis>,
): InertiaRunner<Axis> => {
  let frame: number | undefined = undefined;
  let state: InertialDragInertiaState | undefined = undefined;
  let axis: Axis | undefined = undefined;

  const clear = () => {
    state = undefined;
    axis = undefined;
  };

  const runFrame = (time: number) => {
    if (state === undefined || axis === undefined) {
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

  return {
    start: (velocity, nextAxis, time) => {
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
      clear();
      const nextState = physics.startInertia(velocity, time);
      if (!nextState) {
        handlers.onEnd();
        return;
      }
      state = nextState;
      axis = nextAxis;
      frame = requestAnimationFrame(runFrame);
    },
    stop: (notifyEnd) => {
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
    },
  };
};
