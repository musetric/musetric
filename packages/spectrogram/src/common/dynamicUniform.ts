const alignTo = (value: number, alignment: number): number =>
  Math.ceil(value / alignment) * alignment;

export type CreateDynamicParamsOptions = {
  label: string;
  byteLength: number;
  capacity: number;
};

export type DynamicParams = {
  buffer: GPUBuffer;
  byteLength: number;
  write: (fill: (view: DataView) => void) => number;
  destroy: () => void;
};

const createDynamicParams = (
  device: GPUDevice,
  options: CreateDynamicParamsOptions,
  usage: GPUBufferUsageFlags,
  offsetAlignment: number,
): DynamicParams => {
  const capacity = Math.max(1, Math.floor(options.capacity));
  const stride = alignTo(options.byteLength, offsetAlignment);
  const buffer = device.createBuffer({
    label: options.label,
    size: stride * capacity,
    usage: usage | GPUBufferUsage.COPY_DST,
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

export const createDynamicUniformParams = (
  device: GPUDevice,
  options: CreateDynamicParamsOptions,
): DynamicParams =>
  createDynamicParams(
    device,
    options,
    GPUBufferUsage.UNIFORM,
    device.limits.minUniformBufferOffsetAlignment,
  );

export const createDynamicStorageParams = (
  device: GPUDevice,
  options: CreateDynamicParamsOptions,
): DynamicParams =>
  createDynamicParams(
    device,
    options,
    GPUBufferUsage.STORAGE,
    device.limits.minStorageBufferOffsetAlignment,
  );
