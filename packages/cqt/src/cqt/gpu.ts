export const createStorageBuffer = (
  device: GPUDevice,
  label: string,
  byteLength: number,
): GPUBuffer => {
  const limit = device.limits.maxStorageBufferBindingSize;
  if (byteLength > limit) {
    throw new RangeError(
      `${label} needs ${byteLength} bytes but the storage buffer limit is ` +
        `${limit}; the CQT runs in a single pass, so the input must be split ` +
        `by the caller`,
    );
  }
  return device.createBuffer({
    label,
    size: Math.max(Float32Array.BYTES_PER_ELEMENT, byteLength),
    usage:
      GPUBufferUsage.STORAGE |
      GPUBufferUsage.COPY_SRC |
      GPUBufferUsage.COPY_DST,
  });
};

export const createUniformBuffer = (
  device: GPUDevice,
  label: string,
  values: ArrayBuffer,
): GPUBuffer => {
  const buffer = device.createBuffer({
    label,
    size: values.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(buffer, 0, values);
  return buffer;
};

export const createComputePipeline = (
  device: GPUDevice,
  label: string,
  code: string,
): GPUComputePipeline =>
  device.createComputePipeline({
    label,
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ code }),
      entryPoint: 'main',
    },
  });

export const createBindGroup = (
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  buffers: readonly GPUBuffer[],
): GPUBindGroup =>
  device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: buffers.map((buffer, binding) => ({
      binding,
      resource: { buffer },
    })),
  });

export type ComputeStage = {
  pipeline: GPUComputePipeline;
  bindGroup: GPUBindGroup;
  workgroupsX: number;
  workgroupsY?: number;
};

export const runStage = (
  encoder: GPUCommandEncoder,
  label: string,
  stage: ComputeStage,
  timestampWrites?: GPUComputePassTimestampWrites,
): void => {
  const pass = encoder.beginComputePass({ label, timestampWrites });
  pass.setPipeline(stage.pipeline);
  pass.setBindGroup(0, stage.bindGroup);
  pass.dispatchWorkgroups(stage.workgroupsX, stage.workgroupsY);
  pass.end();
};
