export const createTrigBuffer = (
  device: GPUDevice,
  label: string,
  array: Float32Array<ArrayBuffer>,
): GPUBuffer => {
  const buffer = device.createBuffer({
    label,
    size: array.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(buffer, 0, array);
  return buffer;
};

export const createFftTrigTable = (
  packedWindowSize: number,
): Float32Array<ArrayBuffer> => {
  const table = new Float32Array(packedWindowSize * 2);
  for (let i = 0; i < packedWindowSize; i++) {
    const angle = (2 * Math.PI * i) / packedWindowSize;
    table[2 * i] = Math.cos(angle);
    table[2 * i + 1] = Math.sin(angle);
  }
  return table;
};

export type TrigTables = {
  fft: GPUBuffer;
  r2c: GPUBuffer;
};

export const disposeTrigTables = (tables: TrigTables): void => {
  tables.fft.destroy();
  tables.r2c.destroy();
};
