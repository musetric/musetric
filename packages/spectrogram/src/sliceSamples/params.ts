import { createResourceCell } from '@musetric/resource-utils';
import { type ExtSpectrogramConfig } from '../common/extConfig.js';

export type SliceSamplesParams = {
  windowSize: number;
  paddedWindowSize: number;
  signalStride: number;
  windowCount: number;
  visibleSamples: number;
  step: number;
};

// Byte offset of the per-frame `ringStart` field inside the params buffer.
// Patched every frame from the sample ring without rebuilding the buffer.
export const ringStartByteOffset = 24;

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
  const step = (visibleSamples - windowSize) / (windowCount - 1);
  return {
    windowSize,
    paddedWindowSize,
    signalStride: paddedWindowSize + 2,
    windowCount,
    visibleSamples,
    step,
  };
};

export type StateParams = {
  value: SliceSamplesParams;
  buffer: GPUBuffer;
};

export const createParamsCell = (device: GPUDevice) =>
  createResourceCell({
    create: (config: ExtSpectrogramConfig): StateParams => {
      const value = toParams(config);
      const array = new DataView(new ArrayBuffer(32));
      array.setUint32(0, value.windowSize, true);
      array.setUint32(4, value.paddedWindowSize, true);
      array.setUint32(8, value.signalStride, true);
      array.setUint32(12, value.windowCount, true);
      array.setUint32(16, value.visibleSamples, true);
      array.setFloat32(20, value.step, true);
      array.setUint32(ringStartByteOffset, 0, true);

      const buffer = device.createBuffer({
        label: 'slice-samples-params-buffer',
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
      current.windowSize === next.windowSize &&
      current.windowCount === next.windowCount &&
      current.sampleRate === next.sampleRate &&
      current.visibleTime === next.visibleTime &&
      current.zeroPaddingFactor === next.zeroPaddingFactor,
  });
