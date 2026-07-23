import {
  createFftTrigTable,
  createR2cTrigTable,
  createTrigBuffer,
} from '../../trigTables.js';
import { type TrigTables } from '../trigTables.js';
import { type PackedStockhamR2cVariant } from './support.js';

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
    createR2cTrigTable(variant.windowSize),
  ),
});
