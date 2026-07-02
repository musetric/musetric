import { createResourceCell } from '@musetric/utils';
import { createDynamicUniformParams } from '../common/dynamicUniform.js';
import {
  type ExtSpectrogramConfig,
  type SpectrogramColumnRange,
} from '../common/extConfig.js';

export type SliceSamplesParams = {
  windowSize: number;
  paddedWindowSize: number;
  signalStride: number;
  windowCount: number;
  visibleSamples: number;
  step: number;
};

export const ringStartByteOffset = 24;
export const slotOffsetByteOffset = 28;
export const screenBaseByteOffset = 32;
export const baseColumnByteOffset = 36;
export const baseWindowStartByteOffset = 40;
const paramsByteLength = 48;

const toParams = (config: ExtSpectrogramConfig): SliceSamplesParams => {
  const {
    windowSize,
    windowCount,
    sampleRate,
    visibleTime,
    zeroPaddingFactor,
  } = config;
  const paddedWindowSize = windowSize * zeroPaddingFactor;
  const visibleSamples = Math.ceil(visibleTime * sampleRate + windowSize);
  return {
    windowSize,
    paddedWindowSize,
    signalStride: paddedWindowSize + 2,
    windowCount,
    visibleSamples,
    step: config.columnStep,
  };
};

export type StateParams = {
  value: SliceSamplesParams;
  buffer: GPUBuffer;
  byteLength: number;
  setFrame: (frame: {
    baseColumn: number;
    baseWindowStart: number;
    ringStart: number;
  }) => void;
  writeRange: (range: SpectrogramColumnRange) => number;
};

export const createParamsCell = (device: GPUDevice) =>
  createResourceCell({
    create: (config: ExtSpectrogramConfig): StateParams => {
      const value = toParams(config);
      const params = createDynamicUniformParams(device, {
        label: 'slice-samples-params-buffer',
        byteLength: paramsByteLength,
        capacity: value.windowCount,
      });
      let ringStart = 0;
      let baseColumn = 0;
      let baseWindowStart = 0;

      return {
        value,
        buffer: params.buffer,
        byteLength: params.byteLength,
        setFrame: (frame) => {
          baseColumn = frame.baseColumn;
          baseWindowStart = frame.baseWindowStart;
          ringStart = frame.ringStart;
        },
        writeRange: (range) =>
          params.write((view) => {
            view.setUint32(0, value.windowSize, true);
            view.setUint32(4, value.paddedWindowSize, true);
            view.setUint32(8, value.signalStride, true);
            view.setUint32(12, value.windowCount, true);
            view.setUint32(16, value.visibleSamples, true);
            view.setFloat32(20, value.step, true);
            view.setUint32(ringStartByteOffset, ringStart, true);
            view.setUint32(slotOffsetByteOffset, range.slotOffset, true);
            view.setUint32(screenBaseByteOffset, range.screenBase, true);
            view.setInt32(baseColumnByteOffset, baseColumn, true);
            view.setInt32(baseWindowStartByteOffset, baseWindowStart, true);
            view.setUint32(44, 0, true);
          }),
      };
    },
    dispose: (params) => {
      params.buffer.destroy();
    },
    equals: (current, next) =>
      current.windowSize === next.windowSize &&
      current.windowCount === next.windowCount &&
      current.sampleRate === next.sampleRate &&
      current.visibleTime === next.visibleTime &&
      current.zeroPaddingFactor === next.zeroPaddingFactor &&
      current.columnStep === next.columnStep,
  });
