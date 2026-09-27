export const readGpuBuffer = async (
  device: GPUDevice,
  buffer: GPUBuffer,
): Promise<Float32Array> => {
  const readback = device.createBuffer({
    size: buffer.size,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(buffer, 0, readback, 0, buffer.size);
  device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const values = Float32Array.from(new Float32Array(readback.getMappedRange()));
  readback.unmap();
  readback.destroy();
  return values;
};
