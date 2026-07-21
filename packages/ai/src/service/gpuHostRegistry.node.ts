import {
  type CreateGpuPageOptions,
  type GpuPage,
  type GpuPageHostFactory,
} from './gpuPageHost.node.js';

let factory: GpuPageHostFactory = async (
  options: CreateGpuPageOptions,
): Promise<GpuPage> => {
  const { createPlaywrightGpuPage } =
    await import('./playwrightGpuHost.node.js');
  return createPlaywrightGpuPage(options);
};

export const setGpuPageHostFactory = (next: GpuPageHostFactory): void => {
  factory = next;
};

export const getGpuPageHostFactory = (): GpuPageHostFactory => factory;

let browserBundleDir: string | undefined = undefined;

export const setBrowserBundleDir = (dir: string): void => {
  browserBundleDir = dir;
};

export const getBrowserBundleDir = (): string => {
  if (browserBundleDir === undefined) {
    throw new Error(
      'browser bundle directory is not set, call setBrowserBundleDir first',
    );
  }
  return browserBundleDir;
};
