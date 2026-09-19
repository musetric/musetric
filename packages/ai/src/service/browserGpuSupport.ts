export type GpuSupport = {
  adapter: boolean;
  shaderF16: boolean;
};

export const readGpuSupport = async (): Promise<GpuSupport> => {
  if (!('gpu' in navigator)) {
    return { adapter: false, shaderF16: false };
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    return { adapter: false, shaderF16: false };
  }
  return { adapter: true, shaderF16: adapter.features.has('shader-f16') };
};
