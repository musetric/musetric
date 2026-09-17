import { type InferenceSession } from 'onnxruntime-web/webgpu';

export const defaultStorageBufferLimit = 8;
const maximumStorageBufferLimit = 10;

export type StorageBufferLimitOptions = {
  actual: number;
  required: number;
  label: string;
};

export const assertStorageBufferLimit = (
  options: StorageBufferLimitOptions,
): void => {
  const { actual, required, label } = options;
  if (actual < required) {
    throw new Error(
      `${label} requires ${required} WebGPU storage buffers per shader stage, but this device provides ${actual}`,
    );
  }
};

const ortFeatures: GPUFeatureName[] = [
  'float32-blendable',
  'float32-filterable',
  'shader-f16',
  'subgroups',
  'timestamp-query',
];

export type MusetricWebGpuDevice = {
  device: GPUDevice;
  maxStorageBuffersPerShaderStage: number;
};

const createMusetricWebGpuDevice = async (): Promise<MusetricWebGpuDevice> => {
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) {
    throw new Error('WebGPU adapter is unavailable');
  }
  const limit = Math.min(
    adapter.limits.maxStorageBuffersPerShaderStage,
    maximumStorageBufferLimit,
  );
  const features: GPUFeatureName[] = [];
  for (const feature of ortFeatures) {
    if (adapter.features.has(feature)) {
      features.push(feature);
    }
  }
  const device = await adapter.requestDevice({
    requiredFeatures: features,
    requiredLimits: { maxStorageBuffersPerShaderStage: limit },
  });
  return {
    device,
    maxStorageBuffersPerShaderStage:
      device.limits.maxStorageBuffersPerShaderStage,
  };
};

// eslint-disable-next-line musetric/no-top-level-let
let musetricWebGpuDevice: Promise<MusetricWebGpuDevice> | undefined = undefined;

export const getMusetricWebGpuDevice =
  async (): Promise<MusetricWebGpuDevice> => {
    musetricWebGpuDevice ??= createMusetricWebGpuDevice();
    return musetricWebGpuDevice;
  };

export type MusetricWebGpuProviderOptions = {
  storageBufferCacheMode?: NonNullable<
    InferenceSession.WebGpuExecutionProviderOption['storageBufferCacheMode']
  >;
};

export const musetricWebGpuProvider = async (
  options: MusetricWebGpuProviderOptions = {},
): Promise<InferenceSession.WebGpuExecutionProviderOption> => {
  const { device } = await getMusetricWebGpuDevice();
  return { name: 'webgpu', device, ...options };
};
