import {
  type ComplexCpuBuffer,
  type ComplexGpuBuffer,
} from '../complexArray.js';
import { copyComplexGpuBuffer, copyGpuBuffer } from './copy.js';
import { createComplexGpuBuffer, createGpuBuffer } from './create.js';
import { readComplexGpuBuffer, readGpuBuffer } from './read.js';

export type CreateGpuBufferReaderOptions = {
  device: GPUDevice;
  typeSize: number;
  size: number;
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

export type ComplexGpuBufferReader = {
  read: (input: ComplexGpuBuffer) => Promise<ComplexCpuBuffer>;
  resize: (size: number) => void;
  destroy: () => void;
};

export const createComplexGpuBufferReader = (
  options: CreateGpuBufferReaderOptions,
): ComplexGpuBufferReader => {
  const { device, typeSize } = options;
  let { size } = options;
  let buffer = createComplexGpuBuffer(device, size * typeSize);

  return {
    read: async (input) => {
      await copyComplexGpuBuffer(device, input, buffer, size * typeSize);
      return await readComplexGpuBuffer(buffer);
    },
    resize: (newSize: number) => {
      size = newSize;
      buffer.real.destroy();
      buffer.imag.destroy();
      buffer = createComplexGpuBuffer(device, size * typeSize);
    },
    destroy: () => {
      buffer.real.destroy();
      buffer.imag.destroy();
    },
  };
};
