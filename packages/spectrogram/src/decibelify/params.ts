import { createResourceCell } from '@musetric/utils';
import { createDynamicUniformParams } from '../common/dynamicUniform.js';
import {
  type ExtSpectrogramConfig,
  type SpectrogramColumnRange,
} from '../common/extConfig.js';

export type DecibelifyParams = {
  halfSize: number;
  windowCount: number;
  decibelFactor: number;
  gain: number;
  gainOverReferenceMagnitude: number;
  gateFloorDb: number;
  gateRangeDb: number;
};

export const slotOffsetByteOffset = 28;
const paramsByteLength = 32;

export type DecibelifyParamsArg = {
  config: ExtSpectrogramConfig;
  gainDb: number;
};

const gateFloorDb = -64;
const gateRangeDb = 24;

const toParams = (arg: DecibelifyParamsArg): DecibelifyParams => {
  const halfSize = (arg.config.windowSize * arg.config.zeroPaddingFactor) / 2;
  const gain = 10 ** (arg.gainDb / 20);
  return {
    halfSize,
    windowCount: arg.config.windowCount,
    decibelFactor: (20 * Math.LOG10E) / -arg.config.minDecibel,
    gain,
    gainOverReferenceMagnitude: gain / Math.sqrt(halfSize),
    gateFloorDb,
    gateRangeDb,
  };
};

export type StateParams = {
  value: DecibelifyParams;
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
    create: (arg: DecibelifyParamsArg): StateParams => {
      const value = toParams(arg);
      const params = createDynamicUniformParams(device, {
        label: 'decibelify-params-buffer',
        byteLength: paramsByteLength,
        capacity: value.windowCount * 2,
      });

      return {
        value,
        buffer: params.buffer,
        byteLength: params.byteLength,
        writeRange: (range) => {
          const columnCount = range ? range.columnCount : value.windowCount;
          const byteOffset = params.write((view) => {
            view.setUint32(0, value.halfSize, true);
            view.setUint32(4, value.windowCount, true);
            view.setFloat32(8, value.decibelFactor, true);
            view.setFloat32(12, value.gain, true);
            view.setFloat32(16, value.gainOverReferenceMagnitude, true);
            view.setFloat32(20, value.gateFloorDb, true);
            view.setFloat32(24, value.gateRangeDb, true);
            view.setUint32(
              slotOffsetByteOffset,
              range ? range.slotOffset : 0,
              true,
            );
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
      current.config.windowSize === next.config.windowSize &&
      current.config.windowCount === next.config.windowCount &&
      current.config.zeroPaddingFactor === next.config.zeroPaddingFactor &&
      current.config.minDecibel === next.config.minDecibel &&
      current.gainDb === next.gainDb,
  });
