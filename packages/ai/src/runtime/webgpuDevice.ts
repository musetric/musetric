import * as ort from 'onnxruntime-web/webgpu';

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

const createMusetricWebGpuAdapter = async (): Promise<GPUAdapter> => {
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) {
    throw new Error('WebGPU adapter is unavailable');
  }

  const adapterLimit = adapter.limits.maxStorageBuffersPerShaderStage;
  const storageBufferLimit = Math.min(adapterLimit, maximumStorageBufferLimit);
  const requestDevice = adapter.requestDevice.bind(adapter);
  const requestDeviceWithMusetricLimits = async (
    descriptor: GPUDeviceDescriptor = {},
  ) =>
    requestDevice({
      ...descriptor,
      requiredLimits: {
        ...descriptor.requiredLimits,
        maxStorageBuffersPerShaderStage: storageBufferLimit,
      },
    });
  adapter.requestDevice = requestDeviceWithMusetricLimits;
  // eslint-disable-next-line sonarjs/deprecation, @typescript-eslint/no-deprecated
  ort.env.webgpu.adapter = adapter;

  return adapter;
};

// eslint-disable-next-line musetric/no-top-level-let
let musetricWebGpuAdapter: Promise<GPUAdapter> | undefined = undefined;

const getMusetricWebGpuAdapter = async (): Promise<GPUAdapter> => {
  musetricWebGpuAdapter ??= createMusetricWebGpuAdapter();
  return musetricWebGpuAdapter;
};

export const prepareMusetricWebGpu = async (): Promise<void> => {
  await getMusetricWebGpuAdapter();
};

export type MusetricWebGpuDevice = {
  device: GPUDevice;
  maxStorageBuffersPerShaderStage: number;
};

export const getMusetricWebGpuDevice =
  async (): Promise<MusetricWebGpuDevice> => {
    const adapter = await getMusetricWebGpuAdapter();
    const device = await ort.env.webgpu.device;
    if (!(device instanceof GPUDevice)) {
      throw new Error('ONNX Runtime did not initialize a WebGPU device');
    }

    const actual = device.limits.maxStorageBuffersPerShaderStage;
    const requested = Math.min(
      adapter.limits.maxStorageBuffersPerShaderStage,
      maximumStorageBufferLimit,
    );
    console.log(
      `[musetric/webgpu] storageBuffersPerShaderStage: adapter=${adapter.limits.maxStorageBuffersPerShaderStage}, requested=${requested}, device=${actual}`,
    );

    return { device, maxStorageBuffersPerShaderStage: actual };
  };
