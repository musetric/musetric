export type GpuSupport = {
  adapter: boolean;
  shaderF16: boolean;
};

const noSupport: GpuSupport = { adapter: false, shaderF16: false };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && Boolean(value);

type BrowserGpu = {
  requestAdapter: () => Promise<unknown>;
};

const isBrowserGpu = (value: unknown): value is BrowserGpu =>
  isRecord(value) && typeof value['requestAdapter'] === 'function';

type BrowserGpuAdapter = {
  features: {
    has: (feature: string) => boolean;
  };
};

const isBrowserGpuAdapter = (value: unknown): value is BrowserGpuAdapter => {
  if (!isRecord(value) || !isRecord(value['features'])) {
    return false;
  }
  return typeof value['features']['has'] === 'function';
};

export const readGpuSupport = async (): Promise<GpuSupport> => {
  const browser: unknown = navigator;
  if (!isRecord(browser)) {
    return noSupport;
  }
  const { gpu } = browser;
  if (!isBrowserGpu(gpu)) {
    return noSupport;
  }
  const adapter = await gpu.requestAdapter();
  if (!isBrowserGpuAdapter(adapter)) {
    return noSupport;
  }
  return { adapter: true, shaderF16: adapter.features.has('shader-f16') };
};
