export type StorageBufferType = 'read-only-storage' | 'storage';

export const createBindGroupLayout = (
  device: GPUDevice,
  bufferTypes: readonly StorageBufferType[],
): GPUBindGroupLayout =>
  device.createBindGroupLayout({
    entries: bufferTypes.map((type, binding) => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type },
    })),
  });

export const createComputePipeline = (options: {
  device: GPUDevice;
  layout: GPUBindGroupLayout;
  code: string;
  constants: Record<string, number>;
}): GPUComputePipeline =>
  options.device.createComputePipeline({
    layout: options.device.createPipelineLayout({
      bindGroupLayouts: [options.layout],
    }),
    compute: {
      module: options.device.createShaderModule({ code: options.code }),
      entryPoint: 'main',
      constants: options.constants,
    },
  });

export const createStorageBuffer = (
  device: GPUDevice,
  size: number,
): GPUBuffer =>
  device.createBuffer({
    size,
    usage:
      GPUBufferUsage.STORAGE |
      GPUBufferUsage.COPY_SRC |
      GPUBufferUsage.COPY_DST,
  });

export const createReadbackBuffer = (
  device: GPUDevice,
  size: number,
): GPUBuffer =>
  device.createBuffer({
    size,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

export const createBindGroup = (
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  buffers: readonly GPUBuffer[],
): GPUBindGroup =>
  device.createBindGroup({
    layout,
    entries: buffers.map((buffer, binding) => ({
      binding,
      resource: { buffer },
    })),
  });

export const dispatch2d = (
  pass: GPUComputePassEncoder,
  pipeline: GPUComputePipeline,
  bindGroup: GPUBindGroup,
  x: number,
  y: number,
): void => {
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(x / 16), Math.ceil(y / 16));
};

export const dispatch1d = (
  pass: GPUComputePassEncoder,
  pipeline: GPUComputePipeline,
  bindGroup: GPUBindGroup,
  count: number,
): void => {
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(count / 256));
};
