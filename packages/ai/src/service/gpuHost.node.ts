import {
  type CreateGpuPageOptions,
  type GpuPage,
  type GpuPageHostFactory,
} from './gpuPageHost.node.js';

export const jobProtocolFlag = 'MUSETRIC_GPU_JOB_PROTOCOL';

export type GpuHost = {
  createGpuPage: GpuPageHostFactory;
  browserBundlePath: string;
};

export const defaultGpuPageHostFactory: GpuPageHostFactory = async (
  options: CreateGpuPageOptions,
): Promise<GpuPage> => {
  const { createPlaywrightGpuPage, createPlaywrightJobGpuPage } =
    await import('./playwrightGpuHost.node.js');
  return process.env[jobProtocolFlag] === 'true'
    ? createPlaywrightJobGpuPage(options)
    : createPlaywrightGpuPage(options);
};
