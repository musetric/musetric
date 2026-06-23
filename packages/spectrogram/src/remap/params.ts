import { createResourceCell } from '@musetric/resource-utils';
import { type SpectrogramConfig } from '../config.cross.js';

export type RemapParams = {
  halfSize: number;
  width: number;
  height: number;
  windowSize: number;
  sampleRate: number;
  logMinFrequency: number;
  logFrequencyRange: number;
  decibelFactor: number;
  gain: number;
  gateFloorDb: number;
  gateRangeDb: number;
};

export type RemapParamsArg = {
  config: SpectrogramConfig;
  gainDb: number;
};

const gateFloorDb = -64;
const gateRangeDb = 24;

const toParams = (arg: RemapParamsArg): RemapParams => {
  const {
    sampleRate,
    zeroPaddingFactor,
    minFrequency,
    maxFrequency,
    viewSize,
    minDecibel,
  } = arg.config;
  const { width, height } = viewSize;
  const windowSize = arg.config.windowSize * zeroPaddingFactor;
  const halfSize = windowSize / 2;
  const logMinFrequency = Math.log(minFrequency);
  const logFrequencyRange = Math.log(maxFrequency) - logMinFrequency;
  return {
    halfSize,
    width,
    height,
    windowSize,
    sampleRate,
    logMinFrequency,
    logFrequencyRange,
    decibelFactor: (20 * Math.LOG10E) / -minDecibel,
    gain: 10 ** (arg.gainDb / 20),
    gateFloorDb,
    gateRangeDb,
  };
};

export type StateParams = {
  value: RemapParams;
  buffer: GPUBuffer;
};

export const createParamsCell = (device: GPUDevice) =>
  createResourceCell({
    create: (arg: RemapParamsArg): StateParams => {
      const value = toParams(arg);
      const array = new DataView(new ArrayBuffer(44));
      array.setUint32(0, value.halfSize, true);
      array.setUint32(4, value.width, true);
      array.setUint32(8, value.height, true);
      array.setUint32(12, value.windowSize, true);
      array.setFloat32(16, value.sampleRate, true);
      array.setFloat32(20, value.logMinFrequency, true);
      array.setFloat32(24, value.logFrequencyRange, true);
      array.setFloat32(28, value.decibelFactor, true);
      array.setFloat32(32, value.gain, true);
      array.setFloat32(36, value.gateFloorDb, true);
      array.setFloat32(40, value.gateRangeDb, true);

      const buffer = device.createBuffer({
        label: 'remap-params-buffer',
        size: array.byteLength,
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
      current.config.sampleRate === next.config.sampleRate &&
      current.config.zeroPaddingFactor === next.config.zeroPaddingFactor &&
      current.config.minDecibel === next.config.minDecibel &&
      current.config.minFrequency === next.config.minFrequency &&
      current.config.maxFrequency === next.config.maxFrequency &&
      current.config.viewSize.width === next.config.viewSize.width &&
      current.config.viewSize.height === next.config.viewSize.height &&
      current.gainDb === next.gainDb,
  });
