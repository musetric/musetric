import { createResourceCell } from '@musetric/resource-utils';
import { type ComplexGpuBuffer } from '@musetric/resource-utils/gpu';

export type SignalBufferConfig = {
  windowSize: number;
  windowCount: number;
};
export const createSignalBufferCell = (device: GPUDevice) =>
  createResourceCell({
    create: (config: SignalBufferConfig): ComplexGpuBuffer => {
      const { windowSize, windowCount } = config;

      return {
        real: device.createBuffer({
          label: 'pipeline-signal-real-buffer',
          size: windowSize * windowCount * Float32Array.BYTES_PER_ELEMENT,
          usage:
            GPUBufferUsage.STORAGE |
            GPUBufferUsage.COPY_SRC |
            GPUBufferUsage.COPY_DST,
        }),
        imag: device.createBuffer({
          label: 'pipeline-signal-imag-buffer',
          size: windowSize * windowCount * Float32Array.BYTES_PER_ELEMENT,
          usage:
            GPUBufferUsage.STORAGE |
            GPUBufferUsage.COPY_SRC |
            GPUBufferUsage.COPY_DST,
        }),
      };
    },
    dispose: (buffer) => {
      buffer.real.destroy();
      buffer.imag.destroy();
    },
    equals: (current, next) =>
      current.windowCount === next.windowCount &&
      current.windowSize === next.windowSize,
  });
