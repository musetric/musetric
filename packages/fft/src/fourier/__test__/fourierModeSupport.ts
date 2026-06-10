import { type FourierMode } from '../config.es.js';
import { getPackedStockhamR2cVariant } from '../fftPackedStockhamR2c/support.js';
import { getPackedTiledR2cVariant } from '../fftPackedTiledR2c/support.js';

export const isFourierModeSupported = (
  device: GPUDevice,
  mode: FourierMode,
  config: { windowSize: number; windowCount: number },
): boolean => {
  if (mode === 'fftPackedStockhamR2c') {
    return getPackedStockhamR2cVariant(device, config) !== undefined;
  }

  return getPackedTiledR2cVariant(device, config) !== undefined;
};
