import { createResourceCell } from '@musetric/utils';
import { createDynamicUniformParams } from '../common/dynamicUniform.js';
import {
  type ExtSpectrogramConfig,
  type SpectrogramColumnRange,
} from '../common/extConfig.js';

export const slotOffsetByteOffset = 8;
const paramsByteLength = 16;

export type MagnitudifyParams = {
  windowSize: number;
  windowCount: number;
};

const toParams = (config: ExtSpectrogramConfig): MagnitudifyParams => ({
  windowSize: config.windowSize * config.zeroPaddingFactor,
  windowCount: config.windowCount,
});

export type StateParams = {
  value: MagnitudifyParams;
  buffer: GPUBuffer;
  byteLength: number;
  writeRange: (
    range?: Pick<SpectrogramColumnRange, 'slotOffset' | 'columnCount'>,
  ) => {
    columnCount: number;
    byteOffset: number;
  };
};

export const createParamsCell = (device: GPUDevice) =>
  createResourceCell({
    create: (config: ExtSpectrogramConfig): StateParams => {
      const value = toParams(config);
      const params = createDynamicUniformParams(device, {
        label: 'magnitudify-params-buffer',
        byteLength: paramsByteLength,
        capacity: value.windowCount,
      });

      return {
        value,
        buffer: params.buffer,
        byteLength: params.byteLength,
        writeRange: (range) => {
          const columnCount = range ? range.columnCount : value.windowCount;
          const byteOffset = params.write((view) => {
            view.setUint32(0, value.windowSize, true);
            view.setUint32(4, value.windowCount, true);
            view.setUint32(
              slotOffsetByteOffset,
              range ? range.slotOffset : 0,
              true,
            );
            view.setUint32(12, 0, true);
          });
          return {
            columnCount,
            byteOffset,
          };
        },
      };
    },
    dispose: (params) => {
      params.buffer.destroy();
    },
    equals: (current, next) =>
      current.windowSize === next.windowSize &&
      current.windowCount === next.windowCount &&
      current.zeroPaddingFactor === next.zeroPaddingFactor,
  });
