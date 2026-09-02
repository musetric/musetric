import {
  type CreateGpuPageOptions,
  type GpuPage,
  type GpuPageHostFactory,
} from './gpuPageHost.node.js';
import { type OpenJobPage } from './jobGpuPage.node.js';

export const jobProtocolFlag = 'MUSETRIC_GPU_JOB_PROTOCOL';

export type GpuHost = {
  createGpuPage: GpuPageHostFactory;
  openPage: OpenJobPage;
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

export const defaultOpenJobPage: OpenJobPage = async (url: string) => {
  const { openPlaywrightPage } = await import('./playwrightGpuHost.node.js');
  return openPlaywrightPage(url);
};
