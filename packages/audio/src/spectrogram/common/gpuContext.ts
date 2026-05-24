export type GpuContext = { adapter: GPUAdapter; device: GPUDevice };

export const createGpuContext = async (
  profiling?: boolean,
): Promise<GpuContext> => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) {
    throw new Error('WebGPU adapter not available');
  }
  const device = await adapter.requestDevice({
    requiredFeatures: profiling ? ['timestamp-query'] : undefined,
    requiredLimits: {
      maxComputeWorkgroupStorageSize:
        adapter.limits.maxComputeWorkgroupStorageSize,
    },
  });
  return { adapter, device };
};
