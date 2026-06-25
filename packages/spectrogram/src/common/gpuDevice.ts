import { createGpuContext, type GpuContext } from '@musetric/utils/gpu';

let gpuContext: GpuContext | undefined = undefined;
let promise: Promise<GpuContext> | undefined = undefined;
export const getGpuDevice = async (profiling?: boolean) => {
  promise = promise ?? createGpuContext(profiling);
  gpuContext = gpuContext ?? (await promise);
  return gpuContext.device;
};
