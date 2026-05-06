import { createResourceCell } from '@musetric/resource-utils';
import { parseHexColor } from '../../common/colors.es.js';
import type { SpectrogramConfig } from '../config.cross.js';

const toVec4 = (hex: string): [number, number, number, number] => {
  const { red, green, blue } = parseHexColor(hex);
  return [red / 255, green / 255, blue / 255, 1];
};

export type StateColors = {
  buffer: GPUBuffer;
};
export const createColorsCell = (device: GPUDevice) =>
  createResourceCell({
    create: (config: SpectrogramConfig): StateColors => {
      const array = new Float32Array(12);
      const { colors } = config;
      array.set([
        ...toVec4(colors.played),
        ...toVec4(colors.unplayed),
        ...toVec4(colors.background),
      ]);
      const buffer = device.createBuffer({
        label: 'draw-colors-buffer',
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
    equals: (current, next) =>
      current.colors.played === next.colors.played &&
      current.colors.unplayed === next.colors.unplayed &&
      current.colors.background === next.colors.background,
  });
