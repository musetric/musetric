import { firstPassShader } from './firstPass.js';
import { secondPassShader } from './secondPass.js';
import { type PrunedFourStepR2cVariant } from './support.js';

export type Pipelines = {
  firstPass: GPUComputePipeline;
  secondPass: GPUComputePipeline;
};

const createFirstPassConstants = (variant: PrunedFourStepR2cVariant) => ({
  packedWindowSize: variant.packedWindowSize,
  tileSize: variant.tileSize,
  rowSize: variant.rowSize,
  rowHalfSize: variant.rowHalfSize,
  columnSize: variant.columnSize,
  log2RowSize: variant.log2RowSize,
});

const createSecondPassConstants = (variant: PrunedFourStepR2cVariant) => ({
  packedWindowSize: variant.packedWindowSize,
  positiveWindowSize: variant.packedWindowSize,
  tileSize: variant.tileSize,
  rowSize: variant.rowSize,
  rowHalfSize: variant.rowHalfSize,
  columnSize: variant.columnSize,
  columnHalfSize: variant.columnHalfSize,
  log2ColumnSize: variant.log2ColumnSize,
});

export const createPipelines = (
  device: GPUDevice,
  variant: PrunedFourStepR2cVariant,
): Pipelines => {
  const firstPassModule = device.createShaderModule({
    label: 'pruned-four-step-r2c-first-pass-shader',
    code: firstPassShader,
  });
  const secondPassModule = device.createShaderModule({
    label: 'pruned-four-step-r2c-second-pass-shader',
    code: secondPassShader,
  });

  return {
    firstPass: device.createComputePipeline({
      label: 'pruned-four-step-r2c-first-pass-pipeline',
      layout: 'auto',
      compute: {
        module: firstPassModule,
        entryPoint: 'main',
        constants: createFirstPassConstants(variant),
      },
    }),
    secondPass: device.createComputePipeline({
      label: 'pruned-four-step-r2c-second-pass-pipeline',
      layout: 'auto',
      compute: {
        module: secondPassModule,
        entryPoint: 'main',
        constants: createSecondPassConstants(variant),
      },
    }),
  };
};
