import { describe, expect, it } from 'vitest';
import {
  findLatencyRoute,
  type LatencyRoute,
  putLatencyRoute,
} from '../latencyRoutes.cross.js';

const options = { toleranceFrameCount: 1440, maxCount: 4 };

type Calibrated = LatencyRoute & {
  outputCorrectionFrameCount: number;
};

const calibrated = (
  outputLatencyFrameCount: number,
  outputCorrectionFrameCount: number,
): Calibrated => ({ outputLatencyFrameCount, outputCorrectionFrameCount });

describe('latency routes', () => {
  it('keeps the calibrations of two output routes apart', () => {
    const headphones = putLatencyRoute([], calibrated(13000, 2160), options);
    const routes = putLatencyRoute(headphones, calibrated(1150, 320), options);

    expect(
      findLatencyRoute(routes, 13100, options)?.outputCorrectionFrameCount,
    ).toBe(2160);
    expect(
      findLatencyRoute(routes, 1180, options)?.outputCorrectionFrameCount,
    ).toBe(320);
    expect(findLatencyRoute(routes, 6000, options)).toBeUndefined();
  });

  it('replaces the calibration of the same route', () => {
    const first = putLatencyRoute([], calibrated(13000, 2160), options);
    const routes = putLatencyRoute(first, calibrated(13300, 2400), options);

    expect(routes).toHaveLength(1);
    expect(
      findLatencyRoute(routes, 13000, options)?.outputCorrectionFrameCount,
    ).toBe(2400);
  });

  it('keeps the latest routes up to the limit', () => {
    const routes = [1000, 4000, 7000, 10000, 13000].reduce<Calibrated[]>(
      (stored, latency) =>
        putLatencyRoute(stored, calibrated(latency, latency), options),
      [],
    );

    expect(routes.map((route) => route.outputLatencyFrameCount)).toEqual([
      13000, 10000, 7000, 4000,
    ]);
  });
});
