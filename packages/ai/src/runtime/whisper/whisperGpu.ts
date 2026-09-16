import { createWhisperGpuQueue } from './whisperGpuQueue.js';

export const createWhisperGpu = async () => {
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) {
    throw new Error('WebGPU adapter is unavailable');
  }
  const requiredLimits: Record<string, number> = {};
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- GPUSupportedLimits has enumerable attributes but no index signature.
  const limits = adapter.limits as unknown as Record<string, unknown>;
  for (const key in limits) {
    const value = limits[key];
    if (typeof value === 'number') {
      requiredLimits[key] = value;
    }
  }
  const features = [
    'chromium-experimental-subgroup-matrix',
    'timestamp-query',
    'shader-f16',
    'subgroups',
    'subgroup-size-control',
  ].filter(adapter.features.has.bind(adapter.features));
  const device = await adapter.requestDevice({
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- ORT also uses advertised Chromium extensions absent from GPUFeatureName.
    requiredFeatures: features as GPUFeatureName[],
    requiredLimits,
  });
  const limited =
    adapter.info.vendor === 'qualcomm' &&
    adapter.info.architecture === 'adreno-6xx';
  const queue = limited ? createWhisperGpuQueue(device) : undefined;
  const provider = { name: 'webgpu', device, maxNumPendingDispatches: 2 };

  const runEncoder = async <T>(operation: () => Promise<T>): Promise<T> =>
    queue ? queue.runEncoder(operation) : operation();

  const release = async (): Promise<void> => {
    try {
      await queue?.release();
    } finally {
      device.destroy();
    }
  };

  return { provider, runEncoder, release };
};
