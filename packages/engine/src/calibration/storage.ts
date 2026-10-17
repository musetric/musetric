import { z } from 'zod';
import { findLatencyRoute, putLatencyRoute } from './latencyRoutes.cross.js';

const storageKey = 'musetric.calibration.latencyByDevicePair';
const lastDevicePairStorageKey = 'musetric.calibration.lastDevicePair';
const maxRouteCount = 4;

const storedLatencySchema = z.object({
  outputLatencyFrameCount: z.number(),
  latencyCorrectionFrameCount: z.number(),
  outputCorrectionFrameCount: z.number().optional(),
  source: z.union([z.literal('manual'), z.literal('calibrated')]),
});

const storedRoutesSchema = z.union([
  z.array(storedLatencySchema),
  storedLatencySchema.transform((value) => [value]),
]);

const storedLatencyMapSchema = z.record(z.string(), storedRoutesSchema);

export type StoredLatency = z.infer<typeof storedLatencySchema>;

const load = (): Partial<Record<string, StoredLatency[]>> => {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return {};
    }
    const parsed = storedLatencyMapSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch (error) {
    console.error('Failed to load calibration latency store', error);
    return {};
  }
};

const loadLastDevicePairKey = (): string | undefined => {
  try {
    return localStorage.getItem(lastDevicePairStorageKey) ?? undefined;
  } catch (error) {
    console.error('Failed to load the last calibrated device pair', error);
    return undefined;
  }
};

export type CalibrationLatencyStore = {
  find: (
    devicePairKey: string,
    outputLatencyFrameCount: number,
  ) => StoredLatency | undefined;
  set: (devicePairKey: string, value: StoredLatency) => void;
  getLastDevicePairKey: () => string | undefined;
};

export const createCalibrationLatencyStore = (
  routeToleranceFrameCount: number,
): CalibrationLatencyStore => {
  const entries = load();
  let lastDevicePairKey = loadLastDevicePairKey();
  const routeOptions = {
    toleranceFrameCount: routeToleranceFrameCount,
    maxCount: maxRouteCount,
  };

  const persist = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(entries));
      if (lastDevicePairKey !== undefined) {
        localStorage.setItem(lastDevicePairStorageKey, lastDevicePairKey);
      }
    } catch (error) {
      console.error('Failed to persist calibration latency store', error);
    }
  };

  return {
    find: (devicePairKey, outputLatencyFrameCount) =>
      findLatencyRoute(
        entries[devicePairKey] ?? [],
        outputLatencyFrameCount,
        routeOptions,
      ),
    set: (devicePairKey, value) => {
      entries[devicePairKey] = putLatencyRoute(
        entries[devicePairKey] ?? [],
        value,
        routeOptions,
      );
      lastDevicePairKey = devicePairKey;
      persist();
    },
    getLastDevicePairKey: () => lastDevicePairKey,
  };
};
