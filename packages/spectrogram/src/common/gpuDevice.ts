import { createGpuContext, type GpuContext } from '@musetric/utils/gpu';

const createGpuDeviceLoader = () => {
  let promise: Promise<GpuContext> | undefined = undefined;
  return async (profiling?: boolean) => {
    promise = promise ?? createGpuContext(profiling);
    const gpuContext = await promise;
    return gpuContext.device;
  };
};

export const getGpuDevice = createGpuDeviceLoader();
