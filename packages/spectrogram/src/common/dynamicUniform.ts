const alignTo = (value: number, alignment: number): number =>
  Math.ceil(value / alignment) * alignment;

const unflushed = new WeakMap<GPUDevice, Set<() => void>>();

export const flushDynamicParams = (device: GPUDevice): void => {
  const flushes = unflushed.get(device);
  if (!flushes) {
    return;
  }
  for (const flush of flushes) {
    flush();
  }
  flushes.clear();
};

export type CreateDynamicParamsOptions = {
  label: string;
  byteLength: number;
  capacity: number;
};

export type DynamicParams = {
  buffer: GPUBuffer;
  byteLength: number;
  write: (fill: (view: DataView) => void, from?: number) => number;
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
  const staging = new ArrayBuffer(stride * capacity);
  const views: DataView[] = [];
  const runs: { from: number; to: number }[] = [];
  let cursor = 0;
  const flush = () => {
    for (const run of runs) {
      device.queue.writeBuffer(
        buffer,
        run.from,
        staging,
        run.from,
        run.to - run.from,
      );
    }
    runs.length = 0;
  };
  const flushes = unflushed.get(device) ?? new Set<() => void>();
  unflushed.set(device, flushes);

  return {
    buffer,
    byteLength: options.byteLength,
    write: (fill, from = 0) => {
      const byteOffset = cursor * stride;
      views[cursor] ??= new DataView(staging, byteOffset, options.byteLength);
      fill(views[cursor]);
      cursor = (cursor + 1) % capacity;
      const run = runs.at(-1);
      const end = byteOffset + options.byteLength;
      if (run && run.to <= byteOffset && byteOffset <= run.to + stride) {
        run.to = end;
      } else {
        runs.push({ from: byteOffset + from, to: end });
      }
      flushes.add(flush);
      return byteOffset;
    },
    destroy: () => {
      flushes.delete(flush);
      runs.length = 0;
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
