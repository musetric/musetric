import {
  createFftTrigTable,
  createR2cTrigTable,
  createTrigBuffer,
} from '../trigTables.js';
import { type PackedTiledR2cVariant } from './support.js';

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
  rowFft: createTrigBuffer(
    device,
    'packed-tiled-r2c-row-trig-table',
    createFftTrigTable(variant.rowSize),
  ),
  columnFft: createTrigBuffer(
    device,
    'packed-tiled-r2c-column-trig-table',
    createFftTrigTable(variant.columnSize),
  ),
  fourStep: createTrigBuffer(
    device,
    'packed-tiled-r2c-four-step-trig-table',
    createFourStepTrigTable(variant),
  ),
  r2c: createTrigBuffer(
    device,
    'packed-tiled-r2c-r2c-trig-table',
    createR2cTrigTable(variant.windowSize),
  ),
});

export const disposeTrigTables = (tables: TrigTables): void => {
  tables.rowFft.destroy();
  tables.columnFft.destroy();
  tables.fourStep.destroy();
  tables.r2c.destroy();
};
