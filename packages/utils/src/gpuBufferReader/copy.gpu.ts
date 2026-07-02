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
