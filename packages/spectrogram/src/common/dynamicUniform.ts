export type DynamicUniformParams = {
  buffer: GPUBuffer;
  byteLength: number;
  write: (fill: (view: DataView) => void) => number;
  destroy: () => void;
};

const alignTo = (value: number, alignment: number): number =>
  Math.ceil(value / alignment) * alignment;

export type CreateDynamicUniformParamsOptions = {
  label: string;
  byteLength: number;
  capacity: number;
};

export const createDynamicUniformParams = (
  device: GPUDevice,
  options: CreateDynamicUniformParamsOptions,
): DynamicUniformParams => {
  const capacity = Math.max(1, Math.floor(options.capacity));
  const stride = alignTo(
    options.byteLength,
    device.limits.minUniformBufferOffsetAlignment,
  );
  const buffer = device.createBuffer({
    label: options.label,
    size: stride * capacity,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const scratch = new ArrayBuffer(options.byteLength);
  const view = new DataView(scratch);
  let cursor = 0;

  return {
    buffer,
    byteLength: options.byteLength,
    write: (fill) => {
      const byteOffset = cursor * stride;
      cursor = (cursor + 1) % capacity;
      fill(view);
      device.queue.writeBuffer(buffer, byteOffset, scratch);
      return byteOffset;
    },
    destroy: () => {
      buffer.destroy();
    },
  };
};
