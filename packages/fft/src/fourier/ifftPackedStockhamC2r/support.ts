import { type FourierConfig } from '../config.es.js';
import { isPowerOfTwo } from '../isPowerOfTwo.es.js';

export type PackedStockhamC2rVariant = {
  windowSize: number;
  packedWindowSize: number;
  positiveWindowSize: number;
  log2PackedWindowSize: number;
};

export const getPackedStockhamC2rVariant = (
  device: GPUDevice,
  config: FourierConfig,
): PackedStockhamC2rVariant | undefined => {
  const packedWindowSize = config.windowSize / 2;
  if (
    !Number.isInteger(packedWindowSize) ||
    !isPowerOfTwo(packedWindowSize) ||
    packedWindowSize < 2
  ) {
    return undefined;
  }

  const workgroupBytes = 4 * packedWindowSize * Float32Array.BYTES_PER_ELEMENT;
  if (workgroupBytes > device.limits.maxComputeWorkgroupStorageSize) {
    return undefined;
  }

  return {
    windowSize: config.windowSize,
    packedWindowSize,
    positiveWindowSize: packedWindowSize + 1,
    log2PackedWindowSize: Math.log2(packedWindowSize),
  };
};
