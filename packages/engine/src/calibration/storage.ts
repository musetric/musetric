import { z } from 'zod';

const storageKey = 'musetric.calibration.latencyByDevicePair';

const storedLatencySchema = z.object({
  latencyFrameCount: z.number(),
  inputLatencyFrameCount: z.number(),
  source: z.union([z.literal('manual'), z.literal('calibrated')]),
});

const storedLatencyMapSchema = z.record(z.string(), storedLatencySchema);

export type StoredLatency = z.infer<typeof storedLatencySchema>;

export type CalibrationLatencyStore = {
  get: (devicePairKey: string) => StoredLatency | undefined;
  set: (devicePairKey: string, value: StoredLatency) => void;
};

const load = (): Record<string, StoredLatency> => {
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

export const createCalibrationLatencyStore = (): CalibrationLatencyStore => {
  const entries = load();

  const persist = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(entries));
    } catch (error) {
      console.error('Failed to persist calibration latency store', error);
    }
  };

  return {
    get: (devicePairKey) => entries[devicePairKey],
    set: (devicePairKey, value) => {
      entries[devicePairKey] = value;
      persist();
    },
  };
};
