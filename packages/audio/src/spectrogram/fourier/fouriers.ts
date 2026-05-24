import type { FourierMode } from '../config.cross.js';
import { createFftPackedStockhamR2c } from './fftPackedStockhamR2c/index.js';
import { createFftPrunedFourStepR2c } from './fftPrunedFourStepR2c/index.js';
import { createFftRadix4 } from './fftRadix4/index.js';
import { createFftStockham } from './fftStockham/index.js';
import type { CreateFourier } from './types.js';

export const fouriers: Record<FourierMode, CreateFourier> = {
  fftPrunedFourStepR2c: createFftPrunedFourStepR2c,
  fftPackedStockhamR2c: createFftPackedStockhamR2c,
  fftStockham: createFftStockham,
  fftRadix4: createFftRadix4,
};
