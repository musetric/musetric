import { type FourierMode } from '../config.es.js';
import { getPackedStockhamR2cVariant } from '../fftPackedStockhamR2c/support.js';
import { getPackedTiledR2cVariant } from '../fftPackedTiledR2c/support.js';

export type FourierModeConfig = {
  windowSize: number;
  windowCount: number;
};

export const isFourierModeSupported = (
  device: GPUDevice,
  mode: FourierMode,
  config: FourierModeConfig,
): boolean => {
  if (mode === 'fftPackedStockhamR2c') {
    return getPackedStockhamR2cVariant(device, config) !== undefined;
  }

  return getPackedTiledR2cVariant(device, config) !== undefined;
};
