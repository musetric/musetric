import { type FourierMode } from '../config.cross.js';
import { createFftPackedFusedTiledR2c } from './fftPackedFusedTiledR2c/index.js';
import { createFftPackedStockhamR2c } from './fftPackedStockhamR2c/index.js';
import { createFftPackedTiledR2c } from './fftPackedTiledR2c/index.js';
import { createFftPrunedFourStepR2c } from './fftPrunedFourStepR2c/index.js';
import { type CreateFourier } from './types.js';

export const fouriers: Record<FourierMode, CreateFourier> = {
  fftPackedFusedTiledR2c: createFftPackedFusedTiledR2c,
  fftPackedStockhamR2c: createFftPackedStockhamR2c,
  fftPackedTiledR2c: createFftPackedTiledR2c,
  fftPrunedFourStepR2c: createFftPrunedFourStepR2c,
};
