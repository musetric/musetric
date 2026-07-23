import { createStockhamFourier } from '../fourierRuntime.js';
import { createStateCell } from './state.js';

export const createFftPackedStockhamR2c = createStockhamFourier(
  createStateCell,
  'packed-stockham-r2c-transform',
);
