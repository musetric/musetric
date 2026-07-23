import { type FourierConfig } from '../config.es.js';
import {
  createRadixStages,
  isPowerOfTwo,
  type RadixStageCounts,
} from '../factorization.es.js';
import { selectBalancedTileShape } from '../tileShape.js';

const batchSize = 4;
const maxTileSize = 256;
const maxWindowSize = 65536;
const minPackedWindowSize = 4;
const maxPackedWindowSize = maxWindowSize / 2;

const maxPaddedSecondPassTileSize = 248;
const secondPassPadColumns = 8;

type BaseVariant = {
  windowSize: number;
  packedWindowSize: number;
  tileSize: number;
  rowSize: number;
  rowPairCount: number;
  columnSize: number;
};

export type PackedTiledR2cVariant =
  | (BaseVariant & {
      kind: 'tiled';
      rowHalfSize: number;
      columnHalfSize: number;
      log2RowSize: number;
      log2ColumnSize: number;
    })
  | (BaseVariant & {
      kind: 'tiledMixed';
      rowStageCounts: RadixStageCounts;
      columnStageCounts: RadixStageCounts;
    });

const getRequiredWorkgroupStorageSize = (
  variant: PackedTiledR2cVariant,
): number => {
  const secondPassPad =
    variant.tileSize <= maxPaddedSecondPassTileSize ? secondPassPadColumns : 0;
  return (
    8 *
    batchSize *
    (variant.tileSize + secondPassPad) *
    Float32Array.BYTES_PER_ELEMENT
  );
};

const createPowerOfTwoVariant = (
  windowSize: number,
  packedWindowSize: number,
): PackedTiledR2cVariant | undefined => {
  const log2PackedWindowSize = Math.log2(packedWindowSize);
  const rowSize = 2 ** Math.ceil(log2PackedWindowSize / 2);
  const columnSize = packedWindowSize / rowSize;
  if (rowSize > maxTileSize || columnSize > maxTileSize) {
    return undefined;
  }

  return {
    kind: 'tiled',
    windowSize,
    packedWindowSize,
    tileSize: Math.max(rowSize, columnSize),
    rowSize,
    rowHalfSize: rowSize / 2,
    rowPairCount: rowSize / 2 + 1,
    columnSize,
    columnHalfSize: columnSize / 2,
    log2RowSize: Math.log2(rowSize),
    log2ColumnSize: Math.log2(columnSize),
  };
};

const createMixedVariant = (
  windowSize: number,
  packedWindowSize: number,
): PackedTiledR2cVariant | undefined => {
  const shape = selectBalancedTileShape(packedWindowSize, maxTileSize);
  if (shape === undefined) {
    return undefined;
  }

  const rowStageCounts = createRadixStages(shape.rowSize);
  const columnStageCounts = createRadixStages(shape.columnSize);
  if (rowStageCounts === undefined || columnStageCounts === undefined) {
    return undefined;
  }

  return {
    kind: 'tiledMixed',
    windowSize,
    packedWindowSize,
    tileSize: Math.max(shape.rowSize, shape.columnSize),
    rowSize: shape.rowSize,
    rowPairCount: Math.floor(shape.rowSize / 2) + 1,
    columnSize: shape.columnSize,
    rowStageCounts,
    columnStageCounts,
  };
};

const createVariantFromWindowSize = (
  windowSize: number,
): PackedTiledR2cVariant | undefined => {
  const packedWindowSize = windowSize / 2;
  if (
    packedWindowSize < minPackedWindowSize ||
    packedWindowSize > maxPackedWindowSize ||
    createRadixStages(packedWindowSize) === undefined
  ) {
    return undefined;
  }

  return isPowerOfTwo(packedWindowSize)
    ? createPowerOfTwoVariant(windowSize, packedWindowSize)
    : createMixedVariant(windowSize, packedWindowSize);
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
