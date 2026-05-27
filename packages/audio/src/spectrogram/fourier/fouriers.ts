import type { FourierMode } from '../config.cross.js';
import { createFftPackedStockhamR2c } from './fftPackedStockhamR2c/index.js';
import { createFftPackedTiledR2c } from './fftPackedTiledR2c/index.js';
import { createFftPrunedFourStepR2c } from './fftPrunedFourStepR2c/index.js';
import type { CreateFourier } from './types.js';

export const fouriers: Record<FourierMode, CreateFourier> = {
  fftPackedTiledR2c: createFftPackedTiledR2c,
  fftPrunedFourStepR2c: createFftPrunedFourStepR2c,
  fftPackedStockhamR2c: createFftPackedStockhamR2c,
};
