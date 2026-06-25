import { createResourceCell } from '@musetric/utils';
import { type ExtSpectrogramConfig } from '../common/extConfig.js';

export type DecibelifyParams = {
  halfSize: number;
  windowCount: number;
  decibelFactor: number;
  gain: number;
  gainOverReferenceMagnitude: number;
  gateFloorDb: number;
  gateRangeDb: number;
};

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
};

export const createParamsCell = (device: GPUDevice) =>
  createResourceCell({
    create: (arg: DecibelifyParamsArg): StateParams => {
      const value = toParams(arg);
      const array = new DataView(new ArrayBuffer(32));
      array.setUint32(0, value.halfSize, true);
      array.setUint32(4, value.windowCount, true);
      array.setFloat32(8, value.decibelFactor, true);
      array.setFloat32(12, value.gain, true);
      array.setFloat32(16, value.gainOverReferenceMagnitude, true);
      array.setFloat32(20, value.gateFloorDb, true);
      array.setFloat32(24, value.gateRangeDb, true);

      const buffer = device.createBuffer({
        label: 'decibelify-params-buffer',
        size: array.buffer.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(buffer, 0, array.buffer);

      return {
        value,
        buffer,
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
