import { type PackedTiledR2cVariant } from './support.js';

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
  size: number,
  entryCount: number,
): Float32Array<ArrayBuffer> => {
  const table = new Float32Array(entryCount * 2);
  for (let i = 0; i < entryCount; i++) {
    const angle = (2 * Math.PI * i) / size;
    table[2 * i] = Math.cos(angle);
    table[2 * i + 1] = Math.sin(angle);
  }
  return table;
};

const createFourStepTrigTable = (
  variant: PackedTiledR2cVariant,
): Float32Array<ArrayBuffer> => {
  const table = new Float32Array(variant.packedWindowSize * 2);
  for (let k2 = 0; k2 < variant.rowSize; k2++) {
    for (let n1 = 0; n1 < variant.columnSize; n1++) {
      const index = k2 * variant.columnSize + n1;
      const angle = (2 * Math.PI * k2 * n1) / variant.packedWindowSize;
      table[2 * index] = Math.cos(angle);
      table[2 * index + 1] = Math.sin(angle);
    }
  }
  return table;
};

const createR2cTrigTable = (
  variant: PackedTiledR2cVariant,
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

export type TrigTables = {
  rowFft: GPUBuffer;
  columnFft: GPUBuffer;
  fourStep: GPUBuffer;
  r2c: GPUBuffer;
};

export const createTrigTables = (
  device: GPUDevice,
  variant: PackedTiledR2cVariant,
): TrigTables => ({
  rowFft: createBuffer(
    device,
    'packed-tiled-r2c-row-trig-table',
    createFftTrigTable(variant.rowSize, variant.rowSize),
  ),
  columnFft: createBuffer(
    device,
    'packed-tiled-r2c-column-trig-table',
    createFftTrigTable(variant.columnSize, variant.columnSize),
  ),
  fourStep: createBuffer(
    device,
    'packed-tiled-r2c-four-step-trig-table',
    createFourStepTrigTable(variant),
  ),
  r2c: createBuffer(
    device,
    'packed-tiled-r2c-r2c-trig-table',
    createR2cTrigTable(variant),
  ),
});

export const disposeTrigTables = (tables: TrigTables): void => {
  tables.rowFft.destroy();
  tables.columnFft.destroy();
  tables.fourStep.destroy();
  tables.r2c.destroy();
};
