export type InertialDragPhysicsOptions = {
  inertiaTimeConstantMs?: number;
  inertiaMinimumVelocity?: number;
  inertiaVelocityMultiplier?: number;
  stationaryDistance?: number;
  stationaryVelocityResetMs?: number;
  velocitySampleDurationMs?: number;
};

export type InertialDragVelocityTracker = {
  add: (position: number, time: number) => number;
  release: (position: number, time: number) => number;
};

export type InertialDragInertiaState = {
  previousTime: number;
  velocity: number;
};

export type InertialDragInertiaStep = {
  done: boolean;
  delta: number;
  velocity: number;
};

export type InertialDragPhysics = {
  inertiaMinimumVelocity: number;
  createVelocityTracker: (
    position: number,
    time: number,
  ) => InertialDragVelocityTracker;
  startInertia: (
    velocity: number,
    time: number,
  ) => InertialDragInertiaState | undefined;
  advanceInertia: (
    state: InertialDragInertiaState,
    time: number,
  ) => InertialDragInertiaStep;
};

type PointerSample = {
  position: number;
  time: number;
};

const appendPointerSample = (
  samples: PointerSample[],
  position: number,
  time: number,
  velocitySampleDurationMs: number,
) => {
  samples.push({ position, time });

  while (
    samples.length > 1 &&
    time - samples[0].time > velocitySampleDurationMs
  ) {
    samples.shift();
  }
};

const getVelocity = (samples: PointerSample[]) => {
  if (samples.length < 2) {
    return 0;
  }

  const [firstSample] = samples;
  const lastSample = samples[samples.length - 1];
  const duration = lastSample.time - firstSample.time;

  if (duration <= 0) {
    return 0;
  }

  return ((lastSample.position - firstSample.position) / duration) * 1000;
};

export const createInertialDragPhysics = (
  options: InertialDragPhysicsOptions = {},
): InertialDragPhysics => {
  const {
    inertiaTimeConstantMs = 280,
    inertiaMinimumVelocity = 36,
    inertiaVelocityMultiplier = 1.25,
    stationaryDistance = 0.5,
    stationaryVelocityResetMs = 80,
    velocitySampleDurationMs = 90,
  } = options;

  return {
    inertiaMinimumVelocity,
    createVelocityTracker: (position, time) => {
      const samples: PointerSample[] = [{ position, time }];

      return {
        add: (nextPosition, nextTime) => {
          appendPointerSample(
            samples,
            nextPosition,
            nextTime,
            velocitySampleDurationMs,
          );
          return getVelocity(samples);
        },
        release: (releasePosition, releaseTime) => {
          const lastSample = samples[samples.length - 1];

          if (
            Math.abs(releasePosition - lastSample.position) <=
              stationaryDistance &&
            releaseTime - lastSample.time >= stationaryVelocityResetMs
          ) {
            return 0;
          }

          appendPointerSample(
            samples,
            releasePosition,
            releaseTime,
            velocitySampleDurationMs,
          );
          return getVelocity(samples);
        },
      };
    },
    startInertia: (velocity, time) => {
      if (Math.abs(velocity) < inertiaMinimumVelocity) {
        return undefined;
      }

      return {
        previousTime: time,
        velocity: velocity * inertiaVelocityMultiplier,
      };
    },
    advanceInertia: (state, time) => {
      const elapsedMs = time - state.previousTime;
      const velocity =
        state.velocity * Math.exp(-elapsedMs / inertiaTimeConstantMs);
      const delta = (velocity * elapsedMs) / 1000;

      state.previousTime = time;
      state.velocity = velocity;

      return {
        done: Math.abs(velocity) < inertiaMinimumVelocity,
        delta,
        velocity,
      };
    },
  };
};
