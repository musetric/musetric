import { createPrefixedRadixStageConstants } from '../radixStageConstants.js';
import { firstPassShader } from './firstPass.wgsl.js';
import { firstPassMixedShader } from './firstPassMixed.wgsl.js';
import { secondPassShader } from './secondPass.wgsl.js';
import { secondPassMixedShader } from './secondPassMixed.wgsl.js';
import { type PackedTiledR2cVariant } from './support.js';

const minRadix8Log2TileSize = 7;

const createRadix8StageCounts = (
  log2Size: number,
  prefix: 'row' | 'column',
): Record<string, number> => {
  if (log2Size < minRadix8Log2TileSize) {
    return {
      [`${prefix}Radix8StageCount`]: 0,
      [`${prefix}Radix4StageCount`]: 0,
      [`${prefix}Radix2StageCount`]: log2Size,
    };
  }
  const radix8StageCount = Math.floor(log2Size / 3);
  const remainder = log2Size - radix8StageCount * 3;
  return {
    [`${prefix}Radix8StageCount`]: radix8StageCount,
    [`${prefix}Radix4StageCount`]: remainder === 2 ? 1 : 0,
    [`${prefix}Radix2StageCount`]: remainder === 1 ? 1 : 0,
  };
};

const createFirstPassConstants = (
  variant: PackedTiledR2cVariant,
  inPlace: boolean,
): Record<string, number> => {
  if (variant.kind === 'tiledMixed') {
    return {
      packedWindowSize: variant.packedWindowSize,
      inPlace: inPlace ? 1 : 0,
      tileSize: variant.tileSize,
      rowSize: variant.rowSize,
      columnSize: variant.columnSize,
      smPad: 8,
      ...createPrefixedRadixStageConstants(variant.rowStageCounts, 'row'),
    };
  }

  return {
    packedWindowSize: variant.packedWindowSize,
    inPlace: inPlace ? 1 : 0,
    tileSize: variant.tileSize,
    rowSize: variant.rowSize,
    columnSize: variant.columnSize,
    smPad: 8,
    ...createRadix8StageCounts(variant.log2RowSize, 'row'),
  };
};

const createSecondPassConstants = (
  variant: PackedTiledR2cVariant,
): Record<string, number> => {
  if (variant.kind === 'tiledMixed') {
    return {
      packedWindowSize: variant.packedWindowSize,
      positiveWindowSize: variant.packedWindowSize,
      tileSize: variant.tileSize,
      rowSize: variant.rowSize,
      rowPairCount: variant.rowPairCount,
      columnSize: variant.columnSize,
      smPad: variant.tileSize <= 248 ? 8 : 0,
      ...createPrefixedRadixStageConstants(variant.columnStageCounts, 'column'),
    };
  }

  return {
    packedWindowSize: variant.packedWindowSize,
    positiveWindowSize: variant.packedWindowSize,
    tileSize: variant.tileSize,
    rowSize: variant.rowSize,
    rowHalfSize: variant.rowHalfSize,
    rowPairCount: variant.rowPairCount,
    columnSize: variant.columnSize,
    smPad: variant.tileSize <= 248 ? 8 : 0,
    ...createRadix8StageCounts(variant.log2ColumnSize, 'column'),
  };
};

export type Pipelines = {
  firstPass: GPUComputePipeline;
  secondPass: GPUComputePipeline;
};

export const createPipelines = (
  device: GPUDevice,
  variant: PackedTiledR2cVariant,
  inPlace: boolean,
): Pipelines => {
  const mixed = variant.kind === 'tiledMixed';
  const firstPassModule = device.createShaderModule({
    label: 'packed-tiled-r2c-first-pass-shader',
    code: mixed ? firstPassMixedShader : firstPassShader,
  });
  const secondPassModule = device.createShaderModule({
    label: 'packed-tiled-r2c-second-pass-shader',
    code: mixed ? secondPassMixedShader : secondPassShader,
  });

  return {
    firstPass: device.createComputePipeline({
      label: 'packed-tiled-r2c-first-pass-pipeline',
      layout: 'auto',
      compute: {
        module: firstPassModule,
        entryPoint: 'main',
        constants: createFirstPassConstants(variant, inPlace),
      },
    }),
    secondPass: device.createComputePipeline({
      label: 'packed-tiled-r2c-second-pass-pipeline',
      layout: 'auto',
      compute: {
        module: secondPassModule,
        entryPoint: 'main',
        constants: createSecondPassConstants(variant),
      },
    }),
  };
};
