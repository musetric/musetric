import { type FourierMode } from '../config.es.js';
import { getPackedFusedTiledR2cVariant } from '../fftPackedFusedTiledR2c/support.js';
import { getPackedStockhamR2cVariant } from '../fftPackedStockhamR2c/support.js';
import { getPackedTiledR2cVariant } from '../fftPackedTiledR2c/support.js';
import { getPrunedFourStepR2cVariant } from '../fftPrunedFourStepR2c/support.js';

export const isFourierModeSupported = (
  device: GPUDevice,
  mode: FourierMode,
  config: { windowSize: number; windowCount: number },
): boolean => {
  if (mode === 'fftPackedFusedTiledR2c') {
    return getPackedFusedTiledR2cVariant(device, config) !== undefined;
  }

  if (mode === 'fftPackedStockhamR2c') {
    return getPackedStockhamR2cVariant(device, config) !== undefined;
  }

  if (mode === 'fftPackedTiledR2c') {
    return getPackedTiledR2cVariant(device, config) !== undefined;
  }

  return getPrunedFourStepR2cVariant(device, config) !== undefined;
};
