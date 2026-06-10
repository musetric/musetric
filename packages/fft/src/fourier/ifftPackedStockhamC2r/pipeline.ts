import { multiPassPrepackShader } from './multiPassPrepackShader.js';
import { multiPassStageShader } from './multiPassStageShader.js';
import { multiPassUnpackShader } from './multiPassUnpackShader.js';
import {
  type PackedStockhamC2rStage,
  type PackedStockhamC2rVariant,
} from './support.js';
import { transformInPlaceMixedShader } from './transformInPlaceMixedShader.js';
import { transformShader } from './transformShader.js';

export type SinglePassPipeline = {
  kind: 'singlePass';
  transform: GPUComputePipeline;
};

export type MultiPassPipeline = {
  kind: 'multiPass';
  prepack: GPUComputePipeline;
  stages: GPUComputePipeline[];
  unpack: GPUComputePipeline;
};

export type Pipeline = SinglePassPipeline | MultiPassPipeline;

const stageCount = (counts: { [key: string]: number }): number =>
  counts.radix4StageCount +
  counts.radix2StageCount +
  counts.radix3StageCount +
  counts.radix5StageCount;

const selectTransformThreadCount = (
  variant: Extract<
    PackedStockhamC2rVariant,
    { kind: 'singlePass' | 'inPlaceMixed' }
  >,
): number => {
  if (variant.kind === 'inPlaceMixed') {
    return stageCount(variant.radixStageCounts) <= 4 ? 128 : 256;
  }
  if (variant.packedWindowSize <= 768) {
    return 64;
  }
  if (variant.packedWindowSize <= 1024) {
    return 128;
  }
  return 256;
};

const createTransformConstants = (
  variant: Extract<
    PackedStockhamC2rVariant,
    { kind: 'singlePass' | 'inPlaceMixed' }
  >,
) => ({
  packedWindowSize: variant.packedWindowSize,
  positiveWindowSize: variant.positiveWindowSize,
  threadCount: selectTransformThreadCount(variant),
  ...variant.radixStageCounts,
});

const createPrepackConstants = (
  variant: Extract<PackedStockhamC2rVariant, { kind: 'multiPass' }>,
) => ({
  packedWindowSize: variant.packedWindowSize,
  positiveWindowSize: variant.positiveWindowSize,
  writeBufferIndex: variant.prepackWriteBufferIndex,
});

const createStageConstants = (
  variant: Extract<PackedStockhamC2rVariant, { kind: 'multiPass' }>,
  stage: PackedStockhamC2rStage,
) => ({
  packedWindowSize: variant.packedWindowSize,
  factor: stage.factor,
  stageStride: stage.stageStride,
  readBufferIndex: stage.readBufferIndex,
  writeBufferIndex: stage.writeBufferIndex,
});

const createUnpackConstants = (
  variant: Extract<PackedStockhamC2rVariant, { kind: 'multiPass' }>,
) => ({
  packedWindowSize: variant.packedWindowSize,
  finalReadBufferIndex: variant.finalReadBufferIndex,
});

const createSinglePassPipeline = (
  device: GPUDevice,
  variant: Extract<
    PackedStockhamC2rVariant,
    { kind: 'singlePass' | 'inPlaceMixed' }
  >,
): SinglePassPipeline => {
  const module = device.createShaderModule({
    label: 'packed-stockham-c2r-transform-shader',
    code:
      variant.kind === 'inPlaceMixed'
        ? transformInPlaceMixedShader
        : transformShader,
  });
  return {
    kind: 'singlePass',
    transform: device.createComputePipeline({
      label: 'packed-stockham-c2r-transform-pipeline',
      layout: 'auto',
      compute: {
        module,
        entryPoint: 'main',
        constants: createTransformConstants(variant),
      },
    }),
  };
};

const createMultiPassPipeline = (
  device: GPUDevice,
  variant: Extract<PackedStockhamC2rVariant, { kind: 'multiPass' }>,
): MultiPassPipeline => {
  const prepackModule = device.createShaderModule({
    label: 'packed-stockham-c2r-multipass-prepack-shader',
    code: multiPassPrepackShader,
  });
  const stageModule = device.createShaderModule({
    label: 'packed-stockham-c2r-multipass-stage-shader',
    code: multiPassStageShader,
  });
  const unpackModule = device.createShaderModule({
    label: 'packed-stockham-c2r-multipass-unpack-shader',
    code: multiPassUnpackShader,
  });

  return {
    kind: 'multiPass',
    prepack: device.createComputePipeline({
      label: 'packed-stockham-c2r-multipass-prepack-pipeline',
      layout: 'auto',
      compute: {
        module: prepackModule,
        entryPoint: 'main',
        constants: createPrepackConstants(variant),
      },
    }),
    stages: variant.stages.map((stage) =>
      device.createComputePipeline({
        label: 'packed-stockham-c2r-multipass-stage-pipeline',
        layout: 'auto',
        compute: {
          module: stageModule,
          entryPoint: 'main',
          constants: createStageConstants(variant, stage),
        },
      }),
    ),
    unpack: device.createComputePipeline({
      label: 'packed-stockham-c2r-multipass-unpack-pipeline',
      layout: 'auto',
      compute: {
        module: unpackModule,
        entryPoint: 'main',
        constants: createUnpackConstants(variant),
      },
    }),
  };
};

export const createPipeline = (
  device: GPUDevice,
  variant: PackedStockhamC2rVariant,
): Pipeline => {
  if (variant.kind === 'multiPass') {
    return createMultiPassPipeline(device, variant);
  }
  return createSinglePassPipeline(device, variant);
};
