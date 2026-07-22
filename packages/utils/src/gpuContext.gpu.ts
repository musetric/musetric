import { assertDefined } from './assert.js';

export type GpuContext = { adapter: GPUAdapter; device: GPUDevice };

export const createGpuContext = async (
  profiling?: boolean,
): Promise<GpuContext> => {
  const adapter = assertDefined(
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    await navigator.gpu?.requestAdapter(
      // @see https://issues.chromium.org/issues/369219127
      navigator.userAgent.includes('Windows')
        ? {}
        : { powerPreference: 'high-performance' },
    ),
    'WebGPU adapter not available',
  );
  const device = await adapter.requestDevice({
    requiredFeatures: profiling ? ['timestamp-query'] : undefined,
    requiredLimits: {
      maxBufferSize: adapter.limits.maxBufferSize,
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxComputeWorkgroupStorageSize:
        adapter.limits.maxComputeWorkgroupStorageSize,
      maxComputeWorkgroupsPerDimension:
        adapter.limits.maxComputeWorkgroupsPerDimension,
    },
  });
  return { adapter, device };
};
