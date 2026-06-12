import type * as ort from 'onnxruntime-web/webgpu';

// 'simple' reuses freed buffers by exact size instead of rounding them up to
// power-of-two buckets; on the vocals model this cuts the peak VRAM by ~1.4 GB
// and removes per-run reallocation. ort-web does not forward this option to
// the EP, so it is enabled by the onnxruntime-web patch in .yarn/patches.
export const webGpuExecutionProvider: ort.InferenceSession.ExecutionProviderOption & {
  storageBufferCacheMode: 'simple';
} = {
  name: 'webgpu',
  storageBufferCacheMode: 'simple',
};
