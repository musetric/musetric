import { type FourierMode } from './config.es.js';
import { createFftPackedStockhamR2c } from './fftPackedStockhamR2c/index.js';
import { createFftPackedTiledR2c } from './fftPackedTiledR2c/index.js';
import { type CreateFourier } from './types.js';

export const fouriers: Record<FourierMode, CreateFourier> = {
  fftPackedStockhamR2c: createFftPackedStockhamR2c,
  fftPackedTiledR2c: createFftPackedTiledR2c,
};
