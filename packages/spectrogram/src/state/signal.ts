import { createResourceCell } from '@musetric/resource-utils';

export type SignalBufferConfig = {
  windowSize: number;
  windowCount: number;
};
export const createSignalBufferCell = (device: GPUDevice) =>
  createResourceCell({
    create: (config: SignalBufferConfig): GPUBuffer => {
      const { windowSize, windowCount } = config;

      return device.createBuffer({
        label: 'pipeline-signal-buffer',
        size: (windowSize + 2) * windowCount * Float32Array.BYTES_PER_ELEMENT,
        usage:
          GPUBufferUsage.STORAGE |
          GPUBufferUsage.COPY_SRC |
          GPUBufferUsage.COPY_DST,
      });
    },
    dispose: (buffer) => {
      buffer.destroy();
    },
    equals: (current, next) =>
      current.windowCount === next.windowCount &&
      current.windowSize === next.windowSize,
  });
