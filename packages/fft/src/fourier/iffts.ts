import { type IFourierMode } from './config.es.js';
import { createIfftPackedStockhamC2r } from './ifftPackedStockhamC2r/index.js';
import { type CreateFourier } from './types.js';

export const iffts: Record<IFourierMode, CreateFourier> = {
  ifftPackedStockhamC2r: createIfftPackedStockhamC2r,
};
