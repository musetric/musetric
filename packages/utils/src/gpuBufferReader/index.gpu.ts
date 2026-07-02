import { type ComplexCpuBuffer } from '../complexArray.gpu.js';
import { copyGpuBuffer } from './copy.gpu.js';
import { createGpuBuffer } from './create.gpu.js';
import { readGpuBuffer } from './read.gpu.js';

export type CreateGpuBufferReaderOptions = {
  device: GPUDevice;
  typeSize: number;
  size: number;
};

export type CreateInterleavedGpuBufferReaderOptions = {
  device: GPUDevice;
  windowSize: number;
  windowCount: number;
};

export type GpuBufferReader = {
  read: (input: GPUBuffer) => Promise<ArrayBuffer>;
  resize: (size: number) => void;
  destroy: () => void;
};
export const createGpuBufferReader = (
  options: CreateGpuBufferReaderOptions,
): GpuBufferReader => {
  const { device, typeSize } = options;
  let { size } = options;
  let buffer = createGpuBuffer(device, size * typeSize);

  return {
    read: async (input) => {
      await copyGpuBuffer(device, input, buffer, size * typeSize);
      return await readGpuBuffer(buffer);
    },
    resize: (newSize: number) => {
      size = newSize;
      buffer.destroy();
      buffer = createGpuBuffer(device, newSize * typeSize);
    },
    destroy: () => buffer.destroy(),
  };
};

const interleavedFloatCount = (
  windowSize: number,
  windowCount: number,
): number => {
  return (windowSize + 2) * windowCount;
};

const deinterleaveSpectrum = (
  input: ArrayBuffer,
  windowSize: number,
  windowCount: number,
): ComplexCpuBuffer => {
  const complexStride = windowSize + 2;
  const positiveWindowSize = windowSize / 2 + 1;
  const inputArray = new Float32Array(input);
  const real = new Float32Array(positiveWindowSize * windowCount);
  const imag = new Float32Array(positiveWindowSize * windowCount);

  for (let windowIndex = 0; windowIndex < windowCount; windowIndex++) {
    const inputOffset = complexStride * windowIndex;
    const outputOffset = positiveWindowSize * windowIndex;

    for (let binIndex = 0; binIndex < positiveWindowSize; binIndex++) {
      const inputIndex = inputOffset + binIndex * 2;
      const outputIndex = outputOffset + binIndex;
      real[outputIndex] = inputArray[inputIndex];
      imag[outputIndex] = inputArray[inputIndex + 1];
    }
  }

  return { real: real.buffer, imag: imag.buffer };
};

export type InterleavedGpuBufferReader = {
  read: (input: GPUBuffer) => Promise<ComplexCpuBuffer>;
  resize: (windowSize: number, windowCount: number) => void;
  destroy: () => void;
};

export const createInterleavedGpuBufferReader = (
  options: CreateInterleavedGpuBufferReaderOptions,
): InterleavedGpuBufferReader => {
  const { device } = options;
  let { windowSize, windowCount } = options;
  let buffer = createGpuBuffer(
    device,
    interleavedFloatCount(windowSize, windowCount) *
      Float32Array.BYTES_PER_ELEMENT,
  );

  return {
    read: async (input) => {
      const byteSize =
        interleavedFloatCount(windowSize, windowCount) *
        Float32Array.BYTES_PER_ELEMENT;
      await copyGpuBuffer(device, input, buffer, byteSize);
      return deinterleaveSpectrum(
        await readGpuBuffer(buffer),
        windowSize,
        windowCount,
      );
    },
    resize: (newWindowSize, newWindowCount) => {
      windowSize = newWindowSize;
      windowCount = newWindowCount;
      buffer.destroy();
      buffer = createGpuBuffer(
        device,
        interleavedFloatCount(windowSize, windowCount) *
          Float32Array.BYTES_PER_ELEMENT,
      );
    },
    destroy: () => buffer.destroy(),
  };
};
