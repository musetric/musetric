import {
  type CreateGpuPageOptions,
  type GpuPage,
  type GpuPageHostFactory,
} from './gpuPageHost.node.js';

export type GpuHost = {
  createGpuPage: GpuPageHostFactory;
  browserBundlePath: string;
};

export const defaultGpuPageHostFactory: GpuPageHostFactory = async (
  options: CreateGpuPageOptions,
): Promise<GpuPage> => {
  const { createPlaywrightGpuPage } =
    await import('./playwrightGpuHost.node.js');
  return createPlaywrightGpuPage(options);
};
