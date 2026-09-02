export const gpuSupportApiName = 'musetricAiReadGpuSupport';

export type GpuSupport = {
  adapter: boolean;
  shaderF16: boolean;
};

const noSupport: GpuSupport = { adapter: false, shaderF16: false };

export const readGpuSupport = async (): Promise<GpuSupport> => {
  const gpu: unknown = Reflect.get(navigator, 'gpu');
  if (typeof gpu !== 'object' || !gpu) {
    return noSupport;
  }
  const requestAdapter: unknown = Reflect.get(gpu, 'requestAdapter');
  if (typeof requestAdapter !== 'function') {
    return noSupport;
  }
  const adapter: unknown = await Reflect.apply(requestAdapter, gpu, []);
  if (typeof adapter !== 'object' || !adapter) {
    return noSupport;
  }
  const features: unknown = Reflect.get(adapter, 'features');
  const has: unknown =
    typeof features === 'object' && features
      ? Reflect.get(features, 'has')
      : undefined;
  const shaderF16 =
    typeof has === 'function'
      ? Boolean(Reflect.apply(has, features, ['shader-f16']))
      : false;
  return { adapter: true, shaderF16 };
};
