import { type FourierConfig } from '../config.es.js';

export type PackedTiledR2cVariant = {
  windowSize: number;
  packedWindowSize: number;
  tileSize: number;
  rowSize: number;
  rowHalfSize: number;
  rowPairCount: number;
  columnSize: number;
  columnHalfSize: number;
  log2RowSize: number;
  log2ColumnSize: number;
};

const batchSize = 4;
const maxTileSize = 256;
const maxWindowSize = 65536;
const minPackedWindowSize = 4;
const maxPackedWindowSize = maxWindowSize / 2;

const isPowerOfTwo = (value: number): boolean =>
  Number.isInteger(Math.log2(value));

const createVariant = (
  windowSize: number,
  rowSize: number,
  columnSize: number,
): PackedTiledR2cVariant => ({
  windowSize,
  packedWindowSize: windowSize / 2,
  tileSize: Math.max(rowSize, columnSize),
  rowSize,
  rowHalfSize: rowSize / 2,
  rowPairCount: rowSize / 2 + 1,
  columnSize,
  columnHalfSize: columnSize / 2,
  log2RowSize: Math.log2(rowSize),
  log2ColumnSize: Math.log2(columnSize),
});

const getRequiredWorkgroupStorageSize = (
  variant: PackedTiledR2cVariant,
): number => 8 * batchSize * variant.tileSize * Float32Array.BYTES_PER_ELEMENT;

const createVariantFromWindowSize = (
  windowSize: number,
): PackedTiledR2cVariant | undefined => {
  const packedWindowSize = windowSize / 2;
  if (
    !Number.isInteger(packedWindowSize) ||
    !isPowerOfTwo(packedWindowSize) ||
    packedWindowSize < minPackedWindowSize ||
    packedWindowSize > maxPackedWindowSize
  ) {
    return undefined;
  }

  const log2PackedWindowSize = Math.log2(packedWindowSize);
  const rowSize = 2 ** Math.ceil(log2PackedWindowSize / 2);
  const columnSize = packedWindowSize / rowSize;
  if (rowSize > maxTileSize || columnSize > maxTileSize) {
    return undefined;
  }

  return createVariant(windowSize, rowSize, columnSize);
};

export const getPackedTiledR2cVariant = (
  device: GPUDevice,
  config: FourierConfig,
): PackedTiledR2cVariant | undefined => {
  const variant = createVariantFromWindowSize(config.windowSize);
  if (
    variant === undefined ||
    getRequiredWorkgroupStorageSize(variant) >
      device.limits.maxComputeWorkgroupStorageSize
  ) {
    return undefined;
  }

  return variant;
};
