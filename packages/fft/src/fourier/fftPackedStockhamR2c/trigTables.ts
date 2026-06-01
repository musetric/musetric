import { type PackedStockhamR2cVariant } from './support.js';

export type TrigTables = {
  fft: GPUBuffer;
  r2c: GPUBuffer;
};

const createBuffer = (
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

const createFftTrigTable = (
  variant: PackedStockhamR2cVariant,
): Float32Array<ArrayBuffer> => {
  const table = new Float32Array(variant.packedWindowSize * 2);
  for (let i = 0; i < variant.packedWindowSize; i++) {
    const angle = (2 * Math.PI * i) / variant.packedWindowSize;
    table[2 * i] = Math.cos(angle);
    table[2 * i + 1] = Math.sin(angle);
  }
  return table;
};

const createR2cTrigTable = (
  variant: PackedStockhamR2cVariant,
): Float32Array<ArrayBuffer> => {
  const halfSize = variant.windowSize / 2;
  const table = new Float32Array((halfSize + 1) * 2);
  for (let k = 0; k <= halfSize; k++) {
    const angle = (2 * Math.PI * k) / variant.windowSize;
    table[2 * k] = Math.cos(angle);
    table[2 * k + 1] = Math.sin(angle);
  }
  return table;
};

export const createTrigTables = (
  device: GPUDevice,
  variant: PackedStockhamR2cVariant,
): TrigTables => ({
  fft: createBuffer(
    device,
    'packed-stockham-r2c-fft-trig-table',
    createFftTrigTable(variant),
  ),
  r2c: createBuffer(
    device,
    'packed-stockham-r2c-r2c-trig-table',
    createR2cTrigTable(variant),
  ),
});

export const disposeTrigTables = (tables: TrigTables): void => {
  tables.fft.destroy();
  tables.r2c.destroy();
};
