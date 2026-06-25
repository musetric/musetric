export type GpuContext = { adapter: GPUAdapter; device: GPUDevice };

export const createGpuContext = async (
  profiling?: boolean,
): Promise<GpuContext> => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const adapter = await navigator.gpu?.requestAdapter(
    // https://issues.chromium.org/issues/369219127
    navigator.userAgent.includes('Windows')
      ? {}
      : { powerPreference: 'high-performance' },
  );
  if (!adapter) {
    throw new Error('WebGPU adapter not available');
  }
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
