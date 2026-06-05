import { type FourierConfig } from '../config.es.js';
import {
  createRadixStages,
  type RadixStageCounts,
} from '../factorization.es.js';
import { selectBalancedTileShape, type TileShape } from '../tileShape.js';

export type PackedFusedTiledR2cKind = 'fused' | 'fusedInPlace';

export type PackedFusedTiledR2cVariant = {
  kind: PackedFusedTiledR2cKind;
  windowSize: number;
  packedWindowSize: number;
  rowSize: number;
  columnSize: number;
  rowStageCounts: RadixStageCounts;
  columnStageCounts: RadixStageCounts;
};

const maxTileSize = 256;
const maxWindowSize = 65536;
const minPackedWindowSize = 4;
const maxPackedWindowSize = maxWindowSize / 2;

const createVariant = (
  windowSize: number,
  shape: TileShape,
  rowStageCounts: RadixStageCounts,
  columnStageCounts: RadixStageCounts,
  kind: PackedFusedTiledR2cKind,
): PackedFusedTiledR2cVariant => {
  const { rowSize, columnSize } = shape;

  return {
    kind,
    windowSize,
    packedWindowSize: windowSize / 2,
    rowSize,
    columnSize,
    rowStageCounts,
    columnStageCounts,
  };
};

const getFusedWorkgroupStorageSize = (
  variant: PackedFusedTiledR2cVariant,
): number => 4 * variant.packedWindowSize * Float32Array.BYTES_PER_ELEMENT;

const getFusedInPlaceWorkgroupStorageSize = (
  variant: PackedFusedTiledR2cVariant,
): number => 2 * variant.packedWindowSize * Float32Array.BYTES_PER_ELEMENT;

type VariantSkeleton = TileShape & {
  rowStageCounts: RadixStageCounts;
  columnStageCounts: RadixStageCounts;
};

const createVariantSkeleton = (
  windowSize: number,
): VariantSkeleton | undefined => {
  const packedWindowSize = windowSize / 2;
  if (
    !Number.isInteger(packedWindowSize) ||
    packedWindowSize < minPackedWindowSize ||
    packedWindowSize > maxPackedWindowSize ||
    createRadixStages(packedWindowSize) === undefined
  ) {
    return undefined;
  }

  const shape = selectBalancedTileShape(packedWindowSize, maxTileSize);
  if (shape === undefined) {
    return undefined;
  }

  const rowStageCounts = createRadixStages(shape.rowSize);
  const columnStageCounts = createRadixStages(shape.columnSize);
  if (rowStageCounts === undefined || columnStageCounts === undefined) {
    return undefined;
  }

  return { ...shape, rowStageCounts, columnStageCounts };
};

export const getPackedFusedTiledR2cVariant = (
  device: GPUDevice,
  config: FourierConfig,
): PackedFusedTiledR2cVariant | undefined => {
  const skeleton = createVariantSkeleton(config.windowSize);
  if (skeleton === undefined) {
    return undefined;
  }

  const fused = createVariant(
    config.windowSize,
    skeleton,
    skeleton.rowStageCounts,
    skeleton.columnStageCounts,
    'fused',
  );
  if (
    getFusedWorkgroupStorageSize(fused) <=
    device.limits.maxComputeWorkgroupStorageSize
  ) {
    return fused;
  }

  const fusedInPlace = createVariant(
    config.windowSize,
    skeleton,
    skeleton.rowStageCounts,
    skeleton.columnStageCounts,
    'fusedInPlace',
  );
  if (
    getFusedInPlaceWorkgroupStorageSize(fusedInPlace) <=
    device.limits.maxComputeWorkgroupStorageSize
  ) {
    return fusedInPlace;
  }

  return undefined;
};
