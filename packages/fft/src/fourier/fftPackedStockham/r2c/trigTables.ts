import {
  createFftTrigTable,
  createTrigBuffer,
  type TrigTables,
} from '../trigTables.js';
import { type PackedStockhamR2cVariant } from './support.js';

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
  fft: createTrigBuffer(
    device,
    'packed-stockham-r2c-fft-trig-table',
    createFftTrigTable(variant.packedWindowSize),
  ),
  r2c: createTrigBuffer(
    device,
    'packed-stockham-r2c-r2c-trig-table',
    createR2cTrigTable(variant),
  ),
});
