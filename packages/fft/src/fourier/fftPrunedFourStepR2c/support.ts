import { type FourierConfig } from '../config.es.js';
import {
  createRadixStages,
  type RadixStageCounts,
} from '../factorization.es.js';
import { selectBalancedTileShape } from '../tileShape.js';

type BaseVariant = {
  windowSize: number;
  packedWindowSize: number;
  tileSize: number;
  rowSize: number;
  rowPairCount: number;
  columnSize: number;
};

export type PrunedFourStepR2cVariant =
  | (BaseVariant & {
      kind: 'fourStep';
      rowHalfSize: number;
      columnHalfSize: number;
      log2RowSize: number;
      log2ColumnSize: number;
    })
  | (BaseVariant & {
      kind: 'fourStepMixed';
      rowStageCounts: RadixStageCounts;
      columnStageCounts: RadixStageCounts;
    });

const maxTileSize = 256;
const maxWindowSize = 65536;
const minPackedWindowSize = 4;
const maxPackedWindowSize = maxWindowSize / 2;

const isPowerOfTwo = (value: number): boolean =>
  Number.isInteger(Math.log2(value));

const getRequiredWorkgroupStorageSize = (
  variant: PrunedFourStepR2cVariant,
): number => 8 * variant.tileSize * Float32Array.BYTES_PER_ELEMENT;

// Power-of-two sizes keep the original balanced radix-2 tiling untouched.
const createPowerOfTwoVariant = (
  windowSize: number,
  packedWindowSize: number,
): PrunedFourStepR2cVariant | undefined => {
  const log2PackedWindowSize = Math.log2(packedWindowSize);
  const rowSize = 2 ** Math.ceil(log2PackedWindowSize / 2);
  const columnSize = packedWindowSize / rowSize;
  if (rowSize > maxTileSize || columnSize > maxTileSize) {
    return undefined;
  }

  return {
    kind: 'fourStep',
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

// Non-power-of-two (radix-3/5) sizes pick a balanced mixed-radix tile shape and
// run the generalized first/second-pass shaders.
const createMixedVariant = (
  windowSize: number,
  packedWindowSize: number,
): PrunedFourStepR2cVariant | undefined => {
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
    kind: 'fourStepMixed',
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
): PrunedFourStepR2cVariant | undefined => {
  const packedWindowSize = windowSize / 2;
  if (
    !Number.isInteger(packedWindowSize) ||
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

export const getPrunedFourStepR2cVariant = (
  device: GPUDevice,
  config: FourierConfig,
): PrunedFourStepR2cVariant | undefined => {
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
