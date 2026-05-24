import { type FourierConfig } from '../config.js';

export type PackedStockhamR2cVariant = {
  kind: 'stockham' | 'inPlaceRadix4';
  windowSize: number;
  packedWindowSize: number;
  log2PackedWindowSize: number;
};

const minPackedWindowSize = 2;

const isPowerOfTwo = (value: number): boolean =>
  Number.isInteger(Math.log2(value));

export const getPackedStockhamR2cVariant = (
  device: GPUDevice,
  config: FourierConfig,
): PackedStockhamR2cVariant | undefined => {
  const packedWindowSize = config.windowSize / 2;
  if (
    !Number.isInteger(packedWindowSize) ||
    !isPowerOfTwo(packedWindowSize) ||
    packedWindowSize < minPackedWindowSize
  ) {
    return undefined;
  }

  const maxStockhamPackedWindowSize = Math.floor(
    device.limits.maxComputeWorkgroupStorageSize / 16,
  );
  if (packedWindowSize <= maxStockhamPackedWindowSize) {
    return {
      kind: 'stockham',
      windowSize: config.windowSize,
      packedWindowSize,
      log2PackedWindowSize: Math.log2(packedWindowSize),
    };
  }

  const log2PackedWindowSize = Math.log2(packedWindowSize);
  const maxInPlacePackedWindowSize = Math.floor(
    device.limits.maxComputeWorkgroupStorageSize / 8,
  );
  if (
    packedWindowSize > maxInPlacePackedWindowSize ||
    log2PackedWindowSize % 2 !== 0
  ) {
    return undefined;
  }

  return {
    kind: 'inPlaceRadix4',
    windowSize: config.windowSize,
    packedWindowSize,
    log2PackedWindowSize,
  };
};
