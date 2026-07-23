export type ComputeBufferKind =
  | 'read-only-storage'
  | 'storage'
  | 'dynamic-uniform';

const bufferByKind: Record<ComputeBufferKind, GPUBufferBindingLayout> = {
  'read-only-storage': { type: 'read-only-storage' },
  storage: { type: 'storage' },
  'dynamic-uniform': { type: 'uniform', hasDynamicOffset: true },
};

export const computeBufferEntries = (
  kinds: ComputeBufferKind[],
  baseBinding = 0,
): GPUBindGroupLayoutEntry[] =>
  kinds.map((kind, index) => ({
    binding: baseBinding + index,
    visibility: GPUShaderStage.COMPUTE,
    buffer: bufferByKind[kind],
  }));
