import type { FourierMode } from '../config.cross.js';
import { createFftPrunedFourStepR2c } from './fftPrunedFourStepR2c/index.js';
import { createFftRadix2 } from './fftRadix2/index.js';
import { createFftRadix4 } from './fftRadix4/index.js';
import type { CreateFourier } from './types.js';

export const fouriers: Record<FourierMode, CreateFourier> = {
  fftPrunedFourStepR2c: createFftPrunedFourStepR2c,
  fftRadix4: createFftRadix4,
  fftRadix2: createFftRadix2,
};
