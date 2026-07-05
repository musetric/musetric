import { createInertialDragPhysics } from '@musetric/utils';

const inertiaMinimumVelocity = 36;
const inertiaVelocityMultiplier = 1.25;
const inertiaTimeConstantMs = 280;
const inertiaStationaryDistance = 0.5;
const inertiaStationaryVelocityResetMs = 80;
const inertiaVelocitySampleDurationMs = 90;

export const createSpectrogramGestureInertiaPhysics = () =>
  createInertialDragPhysics({
    inertiaTimeConstantMs,
    inertiaMinimumVelocity,
    inertiaVelocityMultiplier,
    stationaryDistance: inertiaStationaryDistance,
    stationaryVelocityResetMs: inertiaStationaryVelocityResetMs,
    velocitySampleDurationMs: inertiaVelocitySampleDurationMs,
  });
