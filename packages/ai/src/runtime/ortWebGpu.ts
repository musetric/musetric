import { type InferenceSession } from 'onnxruntime-web/webgpu';

export const webGpuExecutionProvider: InferenceSession.WebGpuExecutionProviderOption =
  {
    name: 'webgpu',
    storageBufferCacheMode: 'simple',
  };
