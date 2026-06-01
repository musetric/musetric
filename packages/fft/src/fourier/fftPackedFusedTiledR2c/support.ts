import { type FourierConfig } from '../config.es.js';

export type PackedFusedTiledR2cKind = 'fused' | 'fusedInPlace';

export type PackedFusedTiledR2cVariant = {
  kind: PackedFusedTiledR2cKind;
  windowSize: number;
  packedWindowSize: number;
  log2PackedWindowSize: number;
  rowSize: number;
  rowHalfSize: number;
  columnSize: number;
  columnHalfSize: number;
  log2RowSize: number;
  log2ColumnSize: number;
  log4RowSize: number;
  log4ColumnSize: number;
};

const maxTileSize = 256;
const maxWindowSize = 65536;
const minPackedWindowSize = 4;
const maxPackedWindowSize = maxWindowSize / 2;

const isPowerOfTwo = (value: number): boolean =>
  Number.isInteger(Math.log2(value));

const isRadix4Compatible = (size: number): boolean =>
  Number.isInteger(Math.log2(size) / 2);

const createVariant = (
  windowSize: number,
  rowSize: number,
  columnSize: number,
  kind: PackedFusedTiledR2cKind,
): PackedFusedTiledR2cVariant => ({
  kind,
  windowSize,
  packedWindowSize: windowSize / 2,
  log2PackedWindowSize: Math.log2(windowSize / 2),
  rowSize,
  rowHalfSize: rowSize / 2,
  columnSize,
  columnHalfSize: columnSize / 2,
  log2RowSize: Math.log2(rowSize),
  log2ColumnSize: Math.log2(columnSize),
  log4RowSize: Math.log2(rowSize) / 2,
  log4ColumnSize: Math.log2(columnSize) / 2,
});

const getFusedWorkgroupStorageSize = (
  variant: PackedFusedTiledR2cVariant,
): number => 4 * variant.packedWindowSize * Float32Array.BYTES_PER_ELEMENT;

const getFusedInPlaceWorkgroupStorageSize = (
  variant: PackedFusedTiledR2cVariant,
): number => 2 * variant.packedWindowSize * Float32Array.BYTES_PER_ELEMENT;

const createVariantSkeleton = (
  windowSize: number,
): { rowSize: number; columnSize: number } | undefined => {
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

  return { rowSize, columnSize };
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
    skeleton.rowSize,
    skeleton.columnSize,
    'fused',
  );
  if (
    getFusedWorkgroupStorageSize(fused) <=
    device.limits.maxComputeWorkgroupStorageSize
  ) {
    return fused;
  }

  if (
    isRadix4Compatible(skeleton.rowSize) &&
    isRadix4Compatible(skeleton.columnSize)
  ) {
    const fusedInPlace = createVariant(
      config.windowSize,
      skeleton.rowSize,
      skeleton.columnSize,
      'fusedInPlace',
    );
    if (
      getFusedInPlaceWorkgroupStorageSize(fusedInPlace) <=
      device.limits.maxComputeWorkgroupStorageSize
    ) {
      return fusedInPlace;
    }
  }

  return undefined;
};
