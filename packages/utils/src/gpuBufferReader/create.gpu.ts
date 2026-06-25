import { type ComplexGpuBuffer } from '../complexArray.gpu.js';

export const createGpuBuffer = (device: GPUDevice, size: number): GPUBuffer => {
  return device.createBuffer({
    label: 'reader-buffer',
    size,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
};

export const createComplexGpuBuffer = (
  device: GPUDevice,
  size: number,
): ComplexGpuBuffer => ({
  real: createGpuBuffer(device, size),
  imag: createGpuBuffer(device, size),
});
