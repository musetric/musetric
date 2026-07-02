export const createGpuBuffer = (device: GPUDevice, size: number): GPUBuffer => {
  return device.createBuffer({
    label: 'reader-buffer',
    size,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
};
