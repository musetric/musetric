import { createStockhamFourier } from '../fourierRuntime.js';
import { createStateCell } from './state.js';

export const createIfftPackedStockhamC2r = createStockhamFourier(
  createStateCell,
  'packed-stockham-c2r-transform',
);
