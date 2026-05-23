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
      const array = new Float32Array(32);
      const { colors } = config;
      const frequencyMap = [
        Math.log(config.minFrequency),
        Math.log(config.maxFrequency) - Math.log(config.minFrequency),
        0,
        0,
      ] as const;
      const recordingThresholds = [
        config.recordingMatchThresholdCents,
        config.recordingCloseThresholdCents,
        config.recordingLineWidthCents,
        0,
      ] as const;
      array.set([
        ...toVec4(colors.foreground),
        ...toVec4(colors.background),
        ...toVec4(colors.primary),
        ...frequencyMap,
        ...toVec4(colors.recordingMatch),
        ...toVec4(colors.recordingClose),
        ...toVec4(colors.recordingMiss),
        ...recordingThresholds,
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
      current.colors.foreground === next.colors.foreground &&
      current.colors.background === next.colors.background &&
      current.colors.primary === next.colors.primary &&
      current.colors.recordingMatch === next.colors.recordingMatch &&
      current.colors.recordingClose === next.colors.recordingClose &&
      current.colors.recordingMiss === next.colors.recordingMiss &&
      current.recordingLineWidthCents === next.recordingLineWidthCents &&
      current.recordingMatchThresholdCents ===
        next.recordingMatchThresholdCents &&
      current.recordingCloseThresholdCents ===
        next.recordingCloseThresholdCents &&
      current.minFrequency === next.minFrequency &&
      current.maxFrequency === next.maxFrequency,
  });
