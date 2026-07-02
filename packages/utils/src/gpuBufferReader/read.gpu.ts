export const readGpuBuffer = async (input: GPUBuffer): Promise<ArrayBuffer> => {
  await input.mapAsync(GPUMapMode.READ);
  const output = input.getMappedRange().slice();
  input.unmap();
  return output;
};
