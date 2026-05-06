import { createResourceCell } from '@musetric/resource-utils';
import type { SpectrogramConfig } from '../config.cross.js';

export type StatePlayheadRatio = {
  buffer: GPUBuffer;
};

export const createStatePlayheadRatioCell = (device: GPUDevice) =>
  createResourceCell({
    create: (config: SpectrogramConfig): StatePlayheadRatio => {
      const array = new Float32Array([1]);
      array[0] = config.playheadRatio;
      const buffer = device.createBuffer({
        label: 'pipeline-playhead-ratio-buffer',
        size: array.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(buffer, 0, array);

      return {
        buffer,
      };
    },
    dispose: (state) => {
      state.buffer.destroy();
    },
    equals: (current, next) => current.playheadRatio === next.playheadRatio,
  });
