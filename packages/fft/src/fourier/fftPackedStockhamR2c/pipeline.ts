import { multiPassPackShader } from './multiPassPackShader.js';
import { multiPassStageShader } from './multiPassStageShader.js';
import {
  type PackedStockhamR2cStage,
  type PackedStockhamR2cVariant,
} from './support.js';
import { transformInPlaceRadix4Shader } from './transformInPlaceRadix4Shader.js';
import { transformShader } from './transformShader.js';

export type SinglePassPipeline = {
  kind: 'stockham' | 'inPlaceRadix4';
  transform: GPUComputePipeline;
};

export type MultiPassPipeline = {
  kind: 'multiPass';
  stages: GPUComputePipeline[];
  pack: GPUComputePipeline;
};

export type Pipeline = SinglePassPipeline | MultiPassPipeline;

const createSinglePassConstants = (variant: PackedStockhamR2cVariant) => ({
  packedWindowSize: variant.packedWindowSize,
  log2PackedWindowSize: variant.log2PackedWindowSize,
});

const createMultiPassStageConstants = (
  variant: Extract<PackedStockhamR2cVariant, { kind: 'multiPass' }>,
  stage: PackedStockhamR2cStage,
) => ({
  packedWindowSize: variant.packedWindowSize,
  factor: stage.factor,
  stageStride: stage.stageStride,
  readFromInput: stage.readFromInput ? 1 : 0,
  readBufferIndex: stage.readBufferIndex,
  writeBufferIndex: stage.writeBufferIndex,
});

const createMultiPassPackConstants = (
  variant: Extract<PackedStockhamR2cVariant, { kind: 'multiPass' }>,
) => ({
  packedWindowSize: variant.packedWindowSize,
  finalReadBufferIndex: variant.finalReadBufferIndex,
});

const createSinglePassPipeline = (
  device: GPUDevice,
  variant: Exclude<PackedStockhamR2cVariant, { kind: 'multiPass' }>,
): SinglePassPipeline => {
  const shader =
    variant.kind === 'inPlaceRadix4'
      ? transformInPlaceRadix4Shader
      : transformShader;
  const module = device.createShaderModule({
    label: 'packed-stockham-r2c-transform-shader',
    code: shader,
  });
  return {
    kind: variant.kind,
    transform: device.createComputePipeline({
      label: 'packed-stockham-r2c-transform-pipeline',
      layout: 'auto',
      compute: {
        module,
        entryPoint: 'main',
        constants: createSinglePassConstants(variant),
      },
    }),
  };
};

const createMultiPassPipeline = (
  device: GPUDevice,
  variant: Extract<PackedStockhamR2cVariant, { kind: 'multiPass' }>,
): MultiPassPipeline => {
  const stageModule = device.createShaderModule({
    label: 'packed-stockham-r2c-multipass-stage-shader',
    code: multiPassStageShader,
  });
  const packModule = device.createShaderModule({
    label: 'packed-stockham-r2c-multipass-pack-shader',
    code: multiPassPackShader,
  });

  return {
    kind: 'multiPass',
    stages: variant.stages.map((stage) =>
      device.createComputePipeline({
        label: 'packed-stockham-r2c-multipass-stage-pipeline',
        layout: 'auto',
        compute: {
          module: stageModule,
          entryPoint: 'main',
          constants: createMultiPassStageConstants(variant, stage),
        },
      }),
    ),
    pack: device.createComputePipeline({
      label: 'packed-stockham-r2c-multipass-pack-pipeline',
      layout: 'auto',
      compute: {
        module: packModule,
        entryPoint: 'main',
        constants: createMultiPassPackConstants(variant),
      },
    }),
  };
};

export function createPipeline(
  device: GPUDevice,
  variant: Extract<PackedStockhamR2cVariant, { kind: 'multiPass' }>,
): MultiPassPipeline;
export function createPipeline(
  device: GPUDevice,
  variant: Exclude<PackedStockhamR2cVariant, { kind: 'multiPass' }>,
): SinglePassPipeline;
export function createPipeline(
  device: GPUDevice,
  variant: PackedStockhamR2cVariant,
): Pipeline {
  if (variant.kind === 'multiPass') {
    return createMultiPassPipeline(device, variant);
  }
  return createSinglePassPipeline(device, variant);
}
