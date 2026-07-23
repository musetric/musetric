import {
  createFftTrigTable,
  createTrigBuffer,
  type TrigTables,
} from '../trigTables.js';
import { type PackedStockhamC2rVariant } from './support.js';

const createR2cTrigTable = (
  variant: PackedStockhamC2rVariant,
): Float32Array<ArrayBuffer> => {
  const table = new Float32Array(variant.positiveWindowSize * 2);
  for (let k = 0; k < variant.positiveWindowSize; k++) {
    const angle = (2 * Math.PI * k) / variant.windowSize;
    table[2 * k] = Math.cos(angle);
    table[2 * k + 1] = Math.sin(angle);
  }
  return table;
};

export const createTrigTables = (
  device: GPUDevice,
  variant: PackedStockhamC2rVariant,
): TrigTables => ({
  fft: createTrigBuffer(
    device,
    'packed-stockham-c2r-fft-trig-table',
    createFftTrigTable(variant.packedWindowSize),
  ),
  r2c: createTrigBuffer(
    device,
    'packed-stockham-c2r-r2c-trig-table',
    createR2cTrigTable(variant),
  ),
});
