import { type ComplexGpuBuffer } from '../complexArray.gpu.js';

export const copyGpuBuffer = async (
  device: GPUDevice,
  input: GPUBuffer,
  output: GPUBuffer,
  size: number,
) => {
  const encoder = device.createCommandEncoder({
    label: 'copy-buffer',
  });
  encoder.copyBufferToBuffer(input, 0, output, 0, size);
  device.queue.submit([encoder.finish()]);
  return device.queue.onSubmittedWorkDone();
};

export const copyComplexGpuBuffer = async (
  device: GPUDevice,
  input: ComplexGpuBuffer,
  output: ComplexGpuBuffer,
  size: number,
) => {
  const encoder = device.createCommandEncoder({
    label: 'copy-complex-buffer',
  });
  encoder.copyBufferToBuffer(input.real, 0, output.real, 0, size);
  encoder.copyBufferToBuffer(input.imag, 0, output.imag, 0, size);
  device.queue.submit([encoder.finish()]);
  return device.queue.onSubmittedWorkDone();
};
