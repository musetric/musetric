import { createPrefixedRadixStageConstants } from '../radixStageConstants.js';
import { fusedTransformInPlaceShader } from './fusedTransformInPlaceShader.js';
import { fusedTransformShader } from './fusedTransformShader.js';
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

const selectFusedThreadCount = (packedWindowSize: number): number => {
  if (packedWindowSize <= 768) {
    return 64;
  }
  if (packedWindowSize <= 1536) {
    return 128;
  }
  return 256;
};

const createFusedConstants = (variant: PackedFusedTiledR2cVariant) => ({
  packedWindowSize: variant.packedWindowSize,
  positiveWindowSize: variant.packedWindowSize,
  threadCount: selectFusedThreadCount(variant.packedWindowSize),
  rowSize: variant.rowSize,
  columnSize: variant.columnSize,
  ...createPrefixedRadixStageConstants(variant.rowStageCounts, 'row'),
  ...createPrefixedRadixStageConstants(variant.columnStageCounts, 'column'),
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
  threadCount: selectFusedThreadCount(variant.packedWindowSize),
  rowSize: variant.rowSize,
  columnSize: variant.columnSize,
  ...createPrefixedRadixStageConstants(variant.rowStageCounts, 'row'),
  ...createPrefixedRadixStageConstants(variant.columnStageCounts, 'column'),
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
