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
  size: number,
  entryCount: number = size,
): Float32Array<ArrayBuffer> => {
  const table = new Float32Array(entryCount * 2);
  for (let i = 0; i < entryCount; i++) {
    const angle = (2 * Math.PI * i) / size;
    table[2 * i] = Math.cos(angle);
    table[2 * i + 1] = Math.sin(angle);
  }
  return table;
};

export const createR2cTrigTable = (
  windowSize: number,
): Float32Array<ArrayBuffer> => {
  const halfSize = windowSize / 2;
  const table = new Float32Array((halfSize + 1) * 2);
  for (let k = 0; k <= halfSize; k++) {
    const angle = (2 * Math.PI * k) / windowSize;
    table[2 * k] = Math.cos(angle);
    table[2 * k + 1] = Math.sin(angle);
  }
  return table;
};
