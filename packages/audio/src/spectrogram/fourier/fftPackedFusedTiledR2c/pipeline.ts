import fusedTransformShader from './fusedTransform.wgsl?raw';
import fusedTransformInPlaceShader from './fusedTransformInPlace.wgsl?raw';
import { type PackedFusedTiledR2cVariant } from './support.js';

export type FusedPipeline = {
  kind: 'fused';
  transform: GPUComputePipeline;
};

export type FusedInPlacePipeline = {
  kind: 'fusedInPlace';
  transform: GPUComputePipeline;
};

export type Pipelines = FusedPipeline | FusedInPlacePipeline;

const createFusedConstants = (variant: PackedFusedTiledR2cVariant) => ({
  packedWindowSize: variant.packedWindowSize,
  positiveWindowSize: variant.packedWindowSize,
  rowSize: variant.rowSize,
  rowHalfSize: variant.rowHalfSize,
  columnSize: variant.columnSize,
  columnHalfSize: variant.columnHalfSize,
  log2RowSize: variant.log2RowSize,
  log2ColumnSize: variant.log2ColumnSize,
  log2PackedWindowSize: variant.log2PackedWindowSize,
});

const createFusedPipeline = (
  device: GPUDevice,
  variant: PackedFusedTiledR2cVariant,
): FusedPipeline => {
  const module = device.createShaderModule({
    label: 'packed-fused-tiled-r2c-fused-shader',
    code: fusedTransformShader,
  });

  return {
    kind: 'fused',
    transform: device.createComputePipeline({
      label: 'packed-fused-tiled-r2c-fused-pipeline',
      layout: 'auto',
      compute: {
        module,
        entryPoint: 'main',
        constants: createFusedConstants(variant),
      },
    }),
  };
};

const createFusedInPlaceConstants = (variant: PackedFusedTiledR2cVariant) => ({
  packedWindowSize: variant.packedWindowSize,
  positiveWindowSize: variant.packedWindowSize,
  rowSize: variant.rowSize,
  columnSize: variant.columnSize,
  log2RowSize: variant.log2RowSize,
  log2ColumnSize: variant.log2ColumnSize,
  log4RowSize: variant.log4RowSize,
  log4ColumnSize: variant.log4ColumnSize,
});

const createFusedInPlacePipeline = (
  device: GPUDevice,
  variant: PackedFusedTiledR2cVariant,
): FusedInPlacePipeline => {
  const module = device.createShaderModule({
    label: 'packed-fused-tiled-r2c-fused-inplace-shader',
    code: fusedTransformInPlaceShader,
  });

  return {
    kind: 'fusedInPlace',
    transform: device.createComputePipeline({
      label: 'packed-fused-tiled-r2c-fused-inplace-pipeline',
      layout: 'auto',
      compute: {
        module,
        entryPoint: 'main',
        constants: createFusedInPlaceConstants(variant),
      },
    }),
  };
};

export const createPipelines = (
  device: GPUDevice,
  variant: PackedFusedTiledR2cVariant,
): Pipelines => {
  if (variant.kind === 'fused') {
    return createFusedPipeline(device, variant);
  }
  return createFusedInPlacePipeline(device, variant);
};
